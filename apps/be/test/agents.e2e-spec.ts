import { INestApplication } from '@nestjs/common';
import { Agent, AgentActivity as AgentActivityContract, Computer } from '@repo/shared';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AgentActivity } from '../src/modules/agents/entities/agent-activity.entity';
import { AgentGatewayService } from '../src/modules/gateway/agent-gateway.service';
import {
  createAgent,
  createComputer,
  createTestApp,
  LoggedInClient,
  registerAndLogin,
  truncateAll,
} from './utils';

const unwrap = <T>(response: request.Response): T => (response.body as { data: T }).data;

describe('Computers and agents (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let gateway: AgentGatewayService;
  let me: LoggedInClient;

  beforeAll(async () => {
    ({ app, dataSource } = await createTestApp());
    gateway = app.get(AgentGatewayService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAll(dataSource);
    me = await registerAndLogin(app);
  });

  const http = () => request(app.getHttpServer());
  const getAgents = async (client = me) =>
    unwrap<Agent[]>(await http().get('/api/v1/agents').set(client.bearer).expect(200));

  it('requires authentication', async () => {
    await http().get('/api/v1/agents').expect(401);
    await http().get('/api/v1/computers').expect(401);
    await http().get('/api/v1/onboarding/cli-status').expect(401);
  });

  describe('listing and isolation', () => {
    it('lists only the caller workspace computers and agents, oldest first', async () => {
      const other = await registerAndLogin(app);
      const c1 = await createComputer(dataSource, me.workspaceId, { name: 'first' });
      const c2 = await createComputer(dataSource, me.workspaceId, {
        name: 'second',
        status: 'offline',
      });
      const a1 = await createAgent(dataSource, me.workspaceId, c1.id, { name: 'A' });
      await createAgent(dataSource, me.workspaceId, c2.id, { name: 'B' });
      const foreignComputer = await createComputer(dataSource, other.workspaceId);
      await createAgent(dataSource, other.workspaceId, foreignComputer.id, { name: 'Foreign' });

      const computers = unwrap<Computer[]>(
        await http().get('/api/v1/computers').set(me.bearer).expect(200),
      );
      expect(computers.map((c) => c.name)).toEqual(['first', 'second']);
      expect(computers[0]).toEqual({
        id: c1.id,
        name: 'first',
        os: 'macOS 26.1 · arm64',
        status: 'online',
        lastHeartbeatAt: expect.any(String),
        keepAwake: false,
        cliVersion: '2.1.0',
      });
      expect(JSON.stringify(computers)).not.toMatch(/apiKey|simulated|workspace/i);

      const agents = await getAgents();
      expect(agents.map((a) => a.name)).toEqual(['A', 'B']);
      expect(agents[0]).toMatchObject({
        id: a1.id,
        computerId: c1.id,
        provider: 'claude-code',
        workdir: '~/workspace',
        maxTurns: 40,
      });

      await http().get(`/api/v1/agents/${a1.id}`).set(other.bearer).expect(404);
      await http()
        .patch(`/api/v1/agents/${a1.id}`)
        .set(other.bearer)
        .send({ persona: 'hijack' })
        .expect(404);
      expect((await getAgents(other)).map((a) => a.name)).toEqual(['Foreign']);
    });

    it('answers 404 for an unknown or malformed agent id', async () => {
      const body = (await http().get('/api/v1/agents/a1').set(me.bearer).expect(404)).body as {
        message: string;
      };
      expect(body.message).toBe('Agent not found');
      await http()
        .get('/api/v1/agents/00000000-0000-4000-8000-000000000000')
        .set(me.bearer)
        .expect(404);
    });
  });

  describe('derived status', () => {
    it('is offline on an offline computer, idle when free, working with a claimed run', async () => {
      const online = await createComputer(dataSource, me.workspaceId, { name: 'on' });
      const offline = await createComputer(dataSource, me.workspaceId, {
        name: 'off',
        status: 'offline',
      });
      const sleeping = await createComputer(dataSource, me.workspaceId, {
        name: 'zzz',
        status: 'sleeping',
      });
      const idle = await createAgent(dataSource, me.workspaceId, online.id, { name: 'idle' });
      const busy = await createAgent(dataSource, me.workspaceId, online.id, { name: 'busy' });
      await createAgent(dataSource, me.workspaceId, offline.id, { name: 'off' });
      const asleep = await createAgent(dataSource, me.workspaceId, sleeping.id, { name: 'asleep' });
      // Busy assignments on an offline computer must not make the agent "working".
      const stuck = await createAgent(dataSource, me.workspaceId, offline.id, { name: 'stuck' });

      const statusOf = async () =>
        Object.fromEntries((await getAgents()).map((a) => [a.name, a.status]));
      expect(await statusOf()).toMatchObject({
        idle: 'idle',
        busy: 'idle',
        off: 'offline',
        asleep: 'offline',
      });

      const created = await gateway.create({
        workspaceId: me.workspaceId,
        agentId: busy.id,
        sourceKind: 'chat',
        sourceId: 'chat-1',
      });
      await gateway.offer(created.id);
      expect(await statusOf()).toMatchObject({ busy: 'idle' });

      const claimed = await gateway.claim(online.id);
      expect(claimed?.id).toBe(created.id);
      expect(await statusOf()).toMatchObject({ busy: 'working', idle: 'idle' });

      await gateway.accept(created.id, 1);
      expect(await statusOf()).toMatchObject({ busy: 'working' });
      const single = unwrap<Agent>(
        await http().get(`/api/v1/agents/${busy.id}`).set(me.bearer).expect(200),
      );
      expect(single.status).toBe('working');
      expect(idle.id).not.toBe(busy.id);

      await gateway.result(created.id, 1, { status: 'completed' });
      expect(await statusOf()).toMatchObject({ busy: 'idle' });

      const stuckRun = await gateway.create({
        workspaceId: me.workspaceId,
        agentId: stuck.id,
        sourceKind: 'task',
        sourceId: 'AG-1',
      });
      await gateway.offer(stuckRun.id);
      await dataSource.query(`UPDATE assignments SET status = 'running' WHERE id = $1`, [
        stuckRun.id,
      ]);
      expect(await statusOf()).toMatchObject({ stuck: 'offline' });
      expect(asleep.id).toBeDefined();
    });
  });

  describe('PATCH /agents/:id', () => {
    it('replaces the persona (empty allowed) and toggles known skills only', async () => {
      const computer = await createComputer(dataSource, me.workspaceId);
      const agent = await createAgent(dataSource, me.workspaceId, computer.id);

      const updated = unwrap<Agent>(
        await http()
          .patch(`/api/v1/agents/${agent.id}`)
          .set(me.bearer)
          .send({
            persona: 'New persona',
            skills: [
              { id: 'git-ops', enabled: false },
              { id: 'translate', enabled: true },
              { id: 'does-not-exist', enabled: true },
            ],
          })
          .expect(200),
      );
      expect(updated.persona).toBe('New persona');
      expect(updated.skills).toEqual([
        { id: 'git-ops', name: 'git-ops', enabled: false },
        { id: 'summarize', name: 'summarize', enabled: true },
        { id: 'translate', name: 'translate', enabled: true },
      ]);

      const skillsOnly = unwrap<Agent>(
        await http()
          .patch(`/api/v1/agents/${agent.id}`)
          .set(me.bearer)
          .send({ skills: [{ id: 'summarize', enabled: false }] })
          .expect(200),
      );
      expect(skillsOnly.persona).toBe('New persona');
      expect(skillsOnly.skills.find((s) => s.id === 'summarize')?.enabled).toBe(false);

      const cleared = unwrap<Agent>(
        await http()
          .patch(`/api/v1/agents/${agent.id}`)
          .set(me.bearer)
          .send({ persona: '' })
          .expect(200),
      );
      expect(cleared.persona).toBe('');
      expect((await getAgents())[0].persona).toBe('');
    });

    it('validates the body', async () => {
      const computer = await createComputer(dataSource, me.workspaceId);
      const agent = await createAgent(dataSource, me.workspaceId, computer.id);
      const patch = (body: unknown) =>
        http()
          .patch(`/api/v1/agents/${agent.id}`)
          .set(me.bearer)
          .send(body as object);
      await patch({ persona: 'x'.repeat(20_001) }).expect(400);
      await patch({ skills: 'nope' }).expect(400);
      await patch({ skills: [{ id: 'git-ops', enabled: 'yes' }] }).expect(400);
      await patch({ persona: 'x'.repeat(20_000) }).expect(200);
    });
  });

  describe('GET /agents/:id/activity', () => {
    it('lists newest first, capped at 50, and [] for unknown agents', async () => {
      const computer = await createComputer(dataSource, me.workspaceId);
      const agent = await createAgent(dataSource, me.workspaceId, computer.id);
      const base = Date.now();
      const rows = Array.from({ length: 55 }, (_, i) =>
        dataSource.getRepository(AgentActivity).create({
          workspaceId: me.workspaceId,
          agentId: agent.id,
          location: i === 54 ? '#all-members' : 'DM',
          request: `request ${i}`,
          status: 'completed',
          at: new Date(base - (54 - i) * 60_000),
        }),
      );
      await dataSource.getRepository(AgentActivity).save(rows);

      const activity = unwrap<AgentActivityContract[]>(
        await http().get(`/api/v1/agents/${agent.id}/activity`).set(me.bearer).expect(200),
      );
      expect(activity).toHaveLength(50);
      expect(activity[0]).toMatchObject({
        where: '#all-members',
        request: 'request 54',
        status: 'completed',
      });
      expect(activity[1].request).toBe('request 53');
      const times = activity.map((a) => Date.parse(a.at));
      expect(times).toEqual([...times].sort((a, b) => b - a));

      const other = await registerAndLogin(app);
      for (const id of [agent.id, 'a1', '00000000-0000-4000-8000-000000000000']) {
        const empty = unwrap<unknown[]>(
          await http().get(`/api/v1/agents/${id}/activity`).set(other.bearer).expect(200),
        );
        expect(empty).toEqual([]);
      }
    });
  });
});
