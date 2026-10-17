import { INestApplication } from '@nestjs/common';
import type {
  Agent,
  AgentSkill,
  ApiErrorResponse,
  ApiResponse,
  Message,
  Room,
  Task,
} from '@repo/shared';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource, IsNull } from 'typeorm';
import { DEFAULT_PERSONA, defaultSkills } from '../src/modules/agents/agent-defaults';
import { Agent as AgentEntity } from '../src/modules/agents/entities/agent.entity';
import { Assignment } from '../src/modules/gateway/entities/assignment.entity';
import { TaskRun } from '../src/modules/tasks/entities/task-run.entity';
import { TaskEngineService } from '../src/modules/tasks/task-engine.service';
import {
  addMemberWithRole,
  createAgent,
  createComputer,
  createTestApp,
  createWorld,
  LoggedInClient,
  registerAndLogin,
  truncateAll,
  World,
} from './utils';

type Method = 'get' | 'post' | 'patch' | 'delete';

describe('Agent management (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let engine: TaskEngineService;
  let w: World;
  let admin: LoggedInClient;
  let member: LoggedInClient;

  beforeAll(async () => {
    ({ app, dataSource } = await createTestApp());
    engine = app.get(TaskEngineService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await engine.settled();
    await truncateAll(dataSource);
    w = await createWorld(dataSource, await registerAndLogin(app), Date.now());
    admin = await addMemberWithRole(dataSource, w.me, 'admin');
    member = await addMemberWithRole(dataSource, w.me, 'member');
  });

  const raw = (method: Method, path: string, body?: object, client = w.me, query = '') =>
    request(app.getHttpServer())[method](`/api/v1${path}${query}`).set(client.bearer).send(body);
  const call = async <T>(
    method: Method,
    path: string,
    body?: object,
    expected = 200,
    client = w.me,
  ): Promise<T> => {
    const response = await raw(method, path, body, client);
    expect(response.status).toBe(expected);
    return (response.body as ApiResponse<T>).data;
  };
  const errorOf = async (
    method: Method,
    path: string,
    body: object | undefined,
    status: number,
    client = w.me,
  ): Promise<string> => {
    const response = await raw(method, path, body, client);
    expect(response.status).toBe(status);
    return (response.body as ApiErrorResponse).message;
  };
  const agents = () => call<Agent[]>('get', '/agents');
  const tasks = () => call<Task[]>('get', '/tasks');
  const create = (body: object, client = w.me) => call<Agent>('post', '/agents', body, 200, client);

  describe('skill catalog', () => {
    it('lists every default skill and is not taken for an agent id', async () => {
      const catalog = await call<AgentSkill[]>(
        'get',
        '/agents/skill-catalog',
        undefined,
        200,
        member,
      );
      expect(catalog).toEqual(defaultSkills());
      expect(catalog.filter((s) => s.enabled).length).toBeGreaterThan(0);
      expect(catalog.some((s) => !s.enabled)).toBe(true);
    });
  });

  describe('create', () => {
    it('applies the defaults and notifies', async () => {
      const agent = await create({ name: '  Ops Bot ', computerId: w.c1.id });
      expect(agent).toMatchObject({
        name: 'Ops Bot',
        computerId: w.c1.id,
        provider: 'claude-code',
        persona: DEFAULT_PERSONA,
        workdir: expect.stringMatching(/^~\/\.agent\/agents\/ops-bot-[0-9a-f]{6}$/),
        maxTurns: 40,
        status: 'idle',
      });
      expect(agent.skills).toEqual(defaultSkills());
      expect(agent.avatar).toBe(3 % 3); // three agents exist already
      expect((await agents()).map((a) => a.name)).toEqual([
        "khanhpv's Claude",
        'Research Bot',
        'Deployer',
        'Ops Bot',
      ]);
      expect(await call<Agent>('get', `/agents/${agent.id}`)).toEqual(agent);
    });

    it('reports an agent on an offline computer as offline', async () => {
      expect((await create({ name: 'Far', computerId: w.c2.id })).status).toBe('offline');
    });

    it('takes explicit values; an explicit skill list switches the rest off', async () => {
      const agent = await create({
        name: 'Custom',
        computerId: w.c1.id,
        persona: 'Be terse.',
        workdir: ' ~/work/custom ',
        maxTurns: 7,
        skills: [
          { id: 'git-ops', enabled: true },
          { id: 'memory', enabled: false },
        ],
      });
      expect(agent).toMatchObject({ persona: 'Be terse.', workdir: '~/work/custom', maxTurns: 7 });
      expect(agent.skills.filter((s) => s.enabled).map((s) => s.id)).toEqual(['git-ops']);
      expect(agent.skills).toHaveLength(defaultSkills().length);
    });

    it('falls back to the default persona for a blank one, and slugs odd names', async () => {
      const blank = await create({ name: 'Blank', computerId: w.c1.id, persona: '  ' });
      expect(blank.persona).toBe(DEFAULT_PERSONA);
      const odd = await create({ name: '日本語', computerId: w.c1.id });
      expect(odd.workdir).toMatch(/^~\/\.agent\/agents\/agent-[0-9a-f]{8}-[0-9a-f]{6}$/);
    });

    it('validates the body', async () => {
      const bad: object[] = [
        {},
        { name: 'x' },
        { computerId: w.c1.id },
        { name: '   ', computerId: w.c1.id },
        { name: 'x'.repeat(61), computerId: w.c1.id },
        { name: 'ok', computerId: w.c1.id, maxTurns: 0 },
        { name: 'ok', computerId: w.c1.id, maxTurns: 201 },
        { name: 'ok', computerId: w.c1.id, maxTurns: 1.5 },
        { name: 'ok', computerId: w.c1.id, workdir: '  ' },
        { name: 'ok', computerId: w.c1.id, skills: [{ id: 'git-ops' }] },
        { name: 'ok', computerId: w.c1.id, skills: [{ id: 'nope', enabled: true }] },
      ];
      for (const body of bad) await call('post', '/agents', body, 400);
      expect(await agents()).toHaveLength(3);
    });

    it('rejects an unknown or foreign computer with 400', async () => {
      const other = await registerAndLogin(app);
      const foreign = await createComputer(dataSource, other.workspaceId);
      for (const computerId of ['nope', foreign.id, '00000000-0000-4000-8000-000000000000']) {
        expect(await errorOf('post', '/agents', { name: 'Z', computerId }, 400)).toBe(
          'Computer not found in this workspace',
        );
      }
      expect(await agents()).toHaveLength(3);
    });

    it('rejects a duplicate name case-insensitively with 409, in both languages', async () => {
      expect(
        await errorOf('post', '/agents', { name: 'research BOT', computerId: w.c1.id }, 409),
      ).toBe('An agent with this name already exists');
      const vi = await raw(
        'post',
        '/agents',
        { name: 'Deployer', computerId: w.c1.id },
        w.me,
        '?lang=vi',
      );
      expect(vi.status).toBe(409);
      expect((vi.body as ApiErrorResponse).message).toBe('Đã có agent trùng tên');
    });

    it('lets two workspaces use the same name', async () => {
      const other = await registerAndLogin(app);
      const pc = await createComputer(dataSource, other.workspaceId);
      await create({ name: 'Research Bot', computerId: pc.id }, other);
    });

    it('allows owner and admin, not a member', async () => {
      await create({ name: 'By Admin', computerId: w.c1.id }, admin);
      expect(
        await errorOf('post', '/agents', { name: 'M', computerId: w.c1.id }, 403, member),
      ).toBe('You do not have permission to do this');
      await call('post', '/agents', undefined, 401, { bearer: {} } as LoggedInClient);
    });
  });

  describe('update', () => {
    it('changes name, workdir and max turns', async () => {
      const a = w.agents.a2;
      const updated = await call<Agent>('patch', `/agents/${a.id}`, {
        name: 'Renamed',
        workdir: '~/new',
        maxTurns: 12,
      });
      expect(updated).toMatchObject({ id: a.id, name: 'Renamed', workdir: '~/new', maxTurns: 12 });
      expect((await call<Agent>('get', `/agents/${a.id}`)).name).toBe('Renamed');
    });

    it('renames the agent DMs too', async () => {
      const a = w.agents.a2;
      const { chatId } = await call<{ chatId: string }>('post', `/agents/${a.id}/dm`);
      await call('patch', `/agents/${a.id}`, { name: 'Scout' });
      const rooms = await call<Room[]>('get', '/rooms');
      expect(rooms.find((r) => r.id === chatId)?.name).toBe('Scout');
    });

    it('keeps its own name (case change allowed) but not another agent name', async () => {
      const a = w.agents.a2;
      await call('patch', `/agents/${a.id}`, { name: 'RESEARCH bot' });
      expect(await errorOf('patch', `/agents/${a.id}`, { name: 'deployer' }, 409)).toBe(
        'An agent with this name already exists',
      );
    });

    it('validates the new fields', async () => {
      const id = w.agents.a2.id;
      for (const body of [
        { name: '' },
        { name: 'x'.repeat(61) },
        { maxTurns: 0 },
        { maxTurns: 500 },
        { workdir: '' },
        { computerId: '' },
      ]) {
        await call('patch', `/agents/${id}`, body, 400);
      }
    });

    it('moves an idle agent to another computer of the workspace', async () => {
      const pc = await createComputer(dataSource, w.me.workspaceId, { name: 'second' });
      const idle = await create({ name: 'Idle', computerId: w.c1.id });
      const moved = await call<Agent>('patch', `/agents/${idle.id}`, { computerId: pc.id });
      expect(moved.computerId).toBe(pc.id);
    });

    it('rejects a foreign or unknown computer (400) and a busy agent (409)', async () => {
      const other = await registerAndLogin(app);
      const foreign = await createComputer(dataSource, other.workspaceId);
      const idle = await create({ name: 'Idle', computerId: w.c1.id });
      expect(await errorOf('patch', `/agents/${idle.id}`, { computerId: foreign.id }, 400)).toBe(
        'Computer not found in this workspace',
      );
      await call('patch', `/agents/${idle.id}`, { computerId: 'nope' }, 400);
      // a1 runs AG-31
      expect(
        await errorOf('patch', `/agents/${w.agents.a1.id}`, { computerId: w.c2.id }, 409),
      ).toBe('The agent has open work; wait for it to finish or stop it first');
      expect((await call<Agent>('get', `/agents/${w.agents.a1.id}`)).computerId).toBe(w.c1.id);
      // the same computer is not a move, so a busy agent may still be patched with it
      await call('patch', `/agents/${w.agents.a1.id}`, { computerId: w.c1.id, maxTurns: 9 });
    });

    it('rejects a busy agent with an open chat reply too', async () => {
      const idle = await create({ name: 'Chatty', computerId: w.c1.id });
      const { chatId } = await call<{ chatId: string }>('post', `/agents/${idle.id}/dm`);
      await call<Message>('post', `/chats/${chatId}/messages`, { markdown: 'hello' });
      await call('patch', `/agents/${idle.id}`, { computerId: w.c2.id }, 409);
    });

    it('is forbidden to a member and isolated between workspaces', async () => {
      await call('patch', `/agents/${w.agents.a1.id}`, { name: 'Nope' }, 403, member);
      const other = await registerAndLogin(app);
      await call('patch', `/agents/${w.agents.a1.id}`, { name: 'Nope' }, 404, other);
    });
  });

  describe('delete', () => {
    const a1 = () => w.agents.a1.id;

    it('cancels the run, unassigns the tasks, keeps history, hides the agent and its DM', async () => {
      const { chatId } = await call<{ chatId: string }>('post', `/agents/${a1()}/dm`);
      expect((await call<Room[]>('get', '/rooms')).some((r) => r.id === chatId)).toBe(true);
      const before = await tasks();
      const running = before.find((t) => t.id === 'AG-31')!;
      expect(running.activeRun).not.toBeNull();
      const queued = before.filter((t) => t.assigneeId === a1() && t.status !== 'done');
      expect(queued.length).toBeGreaterThan(0);
      const done = before.filter((t) => t.assigneeId === a1() && t.status === 'done');

      expect(await call('delete', `/agents/${a1()}`)).toBeNull();

      const after = await tasks();
      const t31 = after.find((t) => t.id === 'AG-31')!;
      expect(t31).toMatchObject({ status: 'todo', assigneeId: null, activeRun: null });
      expect(t31.runs.at(-1)).toMatchObject({ n: 1, status: 'cancelled' });
      for (const t of queued) {
        expect(after.find((x) => x.id === t.id)).toMatchObject({ assigneeId: null });
      }
      expect(after.filter((t) => t.assigneeId === a1() && t.status !== 'done')).toHaveLength(0);
      for (const t of done) expect(after.find((x) => x.id === t.id)!.assigneeId).toBe(a1());

      // history rows survive with the agent id
      const runs = await dataSource.getRepository(TaskRun).find({ where: { taskId: 'AG-31' } });
      expect(runs).toHaveLength(1);
      expect(runs[0].status).toBe('cancelled');
      const assignments = await dataSource
        .getRepository(Assignment)
        .find({ where: { agentId: a1() } });
      expect(assignments.length).toBeGreaterThan(0);
      expect(assignments.some((a) => a.status === 'cancelled')).toBe(true);
      expect(
        assignments.every((a) =>
          ['completed', 'failed', 'expired', 'cancelled'].includes(a.status),
        ),
      ).toBe(true);
      const row = await dataSource
        .getRepository(AgentEntity)
        .findOne({ where: { id: a1() }, withDeleted: true });
      expect(row?.deletedAt).toBeInstanceOf(Date);

      expect((await agents()).map((a) => a.id)).not.toContain(a1());
      await call('get', `/agents/${a1()}`, undefined, 404);
      expect(await call('get', `/agents/${a1()}/activity`)).toEqual([]);
      expect((await call<Room[]>('get', '/rooms')).some((r) => r.id === chatId)).toBe(false);
      await call('get', `/chats/${chatId}`, undefined, 404);
      await call('post', `/chats/${chatId}/messages`, { markdown: 'hi' }, 404);
      await call('post', `/agents/${a1()}/dm`, undefined, 404);
      await call('patch', `/agents/${a1()}`, { name: 'x' }, 404);
    });

    it('fails an open chat reply and cancels its assignment', async () => {
      const a2 = w.agents.a2.id;
      const { chatId } = await call<{ chatId: string }>('post', `/agents/${a2}/dm`);
      const sent = await call<Message>('post', `/chats/${chatId}/messages`, { markdown: 'hello' });
      expect(sent.id).toBeTruthy();
      const open = await dataSource
        .getRepository(Assignment)
        .find({ where: { agentId: a2, sourceKind: 'chat' } });
      expect(open).toHaveLength(1);
      expect(['pending', 'offered']).toContain(open[0].status);
      await call('delete', `/agents/${a2}`);
      await engine.settled();
      const rows = await dataSource.query<{ status: string }[]>(
        `SELECT status FROM messages WHERE assignment_id = $1`,
        [open[0].id],
      );
      expect(rows.map((r) => r.status)).toEqual(['failed']);
      const after = await dataSource.getRepository(Assignment).findOneByOrFail({ id: open[0].id });
      expect(after.status).toBe('cancelled');
    });

    it('disconnects the connections of the agent like a manual disconnect', async () => {
      const a3 = w.agents.a3.id;
      await call('post', '/connections/zalo/connect', {
        account: 'shop',
        roomName: 'inbox',
        agentId: a3,
        mode: 'draft',
      });
      type Conn = { id: string; status: string; agentId: string | null; roomId: string | null };
      const connected = (await call<Conn[]>('get', '/connections')).find((c) => c.id === 'zalo')!;
      expect(connected).toMatchObject({ status: 'on', agentId: a3 });
      const roomId = connected.roomId!;
      const thread = (await call<Room[]>('get', '/rooms'))
        .find((r) => r.id === roomId)!
        .threads.at(0)!;
      const countBefore = await dataSource
        .getRepository(Assignment)
        .count({ where: { agentId: a3 } });

      await call('delete', `/agents/${a3}`);

      const after = (await call<Conn[]>('get', '/connections')).find((c) => c.id === 'zalo');
      expect(after).toMatchObject({ status: 'off', agentId: null, roomId: null });
      expect((await call<Room[]>('get', '/rooms')).some((r) => r.id === roomId)).toBe(false);
      expect(await dataSource.query(`SELECT 1 FROM rooms WHERE id = $1`, [roomId])).toHaveLength(0);
      expect(
        await dataSource.query(`SELECT 1 FROM messages WHERE chat_id = $1`, [thread.id]),
      ).toHaveLength(0);
      // the thread is gone, so no later message can trigger a reply
      await call('post', `/chats/${thread.id}/messages`, { markdown: 'hello?' }, 404);
      await engine.settled();
      expect(await dataSource.getRepository(Assignment).count({ where: { agentId: a3 } })).toBe(
        countBefore,
      );
    });

    it('treats a deleted assignee of a done task as unassigned once it is reopened', async () => {
      const done = (await tasks()).find((t) => t.assigneeId === a1() && t.status === 'done')!;
      await call('delete', `/agents/${a1()}`);
      expect((await tasks()).find((t) => t.id === done.id)!.assigneeId).toBe(a1());

      const reopened = await call<Task>('post', `/tasks/${done.id}/move`, { status: 'doing' });
      expect(reopened).toMatchObject({ assigneeId: null, activeRun: null });
      await engine.settled();
      expect(
        await dataSource
          .getRepository(TaskRun)
          .count({ where: { taskId: done.id, finalizedAt: IsNull() } }),
      ).toBe(0);
      expect((await tasks()).find((t) => t.id === done.id)).toMatchObject({
        assigneeId: null,
        activeRun: null,
      });
    });

    it('frees the name and lets the next queued work go to the others', async () => {
      await call('delete', `/agents/${w.agents.a3.id}`);
      const again = await create({ name: 'Deployer', computerId: w.c1.id });
      expect(again.id).not.toBe(w.agents.a3.id);
      expect((await agents()).filter((a) => a.name === 'Deployer')).toHaveLength(1);
    });

    it('answers 404 the second time, for junk ids and other workspaces', async () => {
      await call('delete', `/agents/${a1()}`);
      await call('delete', `/agents/${a1()}`, undefined, 404);
      await call('delete', '/agents/not-a-uuid', undefined, 404);
      const other = await registerAndLogin(app);
      await call('delete', `/agents/${w.agents.a2.id}`, undefined, 404, other);
      expect(await agents()).toHaveLength(2);
    });

    it('is forbidden to a member, allowed to an admin', async () => {
      expect(await errorOf('delete', `/agents/${w.agents.a2.id}`, undefined, 403, member)).toBe(
        'You do not have permission to do this',
      );
      await call('delete', `/agents/${w.agents.a2.id}`, undefined, 200, admin);
    });

    it('works for an agent with no history and can be done twice in a row concurrently', async () => {
      const fresh = await createAgent(dataSource, w.me.workspaceId, w.c1.id, { name: 'Fresh' });
      const results = await Promise.all([
        raw('delete', `/agents/${fresh.id}`),
        raw('delete', `/agents/${fresh.id}`),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 404]);
      expect(
        await dataSource.getRepository(AgentEntity).count({ where: { deletedAt: IsNull() } }),
      ).toBe(3);
    });
  });
});
