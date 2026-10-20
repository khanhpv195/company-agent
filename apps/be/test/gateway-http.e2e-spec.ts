import { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { ApiResponse, Message, Task } from '@repo/shared';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { ClockService } from '../src/common/clock';
import { LEASE_MS } from '../src/contacts';
import { Agent } from '../src/modules/agents/entities/agent.entity';
import { AgentActivity } from '../src/modules/agents/entities/agent-activity.entity';
import { ChatMessage } from '../src/modules/chat/entities/chat-message.entity';
import { Computer } from '../src/modules/computers/entities/computer.entity';
import { REALTIME_EVENT, RealtimeEnvelope } from '../src/modules/events';
import { MAX_WRITE_CALLS } from '../src/modules/daemon/gateway-tools.service';
import { AgentGatewayService } from '../src/modules/gateway/agent-gateway.service';
import { Assignment } from '../src/modules/gateway/entities/assignment.entity';
import { TaskEntity } from '../src/modules/tasks/entities/task.entity';
import { TaskActivityRow } from '../src/modules/tasks/entities/task-activity.entity';
import { TaskEngineService } from '../src/modules/tasks/task-engine.service';
import {
  addMemberWithRole,
  createAgent,
  createComputer,
  createSkill,
  createTestApp,
  LoggedInClient,
  registerAndLogin,
  setPlan,
  TestClock,
  truncateAll,
} from './utils';

interface Paired {
  computerId: string;
  apiKey: string;
  key: { Authorization: string };
}

interface Claimed {
  id: string;
  attempt: number;
  kind: 'chat' | 'task';
  agent: { id: string; name: string; skills: string[]; workdir: string; maxTurns: number };
  session: { id: string; resume: boolean };
  prompt: string;
  context: string;
  requestedBy: { id: string; name: string; role: string } | null;
  leaseMs: number;
  roomId?: string;
  parentId?: string | null;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const NIL_ROOM = '00000000-0000-0000-0000-000000000000';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('Gateway over HTTP (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let clock: TestClock;
  let emitter: EventEmitter2;
  let engine: TaskEngineService;
  let gateway: AgentGatewayService;
  let me: LoggedInClient;
  let member: LoggedInClient;
  let realtime: RealtimeEnvelope[];
  let paired: Paired;
  let agent: Agent;

  beforeAll(async () => {
    clock = new TestClock();
    ({ app, dataSource } = await createTestApp((builder) =>
      builder.overrideProvider(ClockService).useValue(clock),
    ));
    emitter = app.get(EventEmitter2);
    engine = app.get(TaskEngineService);
    gateway = app.get(AgentGatewayService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAll(dataSource);
    me = await registerAndLogin(app);
    await setPlan(dataSource, me.workspaceId, 'pro');
    member = await addMemberWithRole(dataSource, me, 'member');
    realtime = [];
    emitter.removeAllListeners(REALTIME_EVENT);
    emitter.on(REALTIME_EVENT, (e: RealtimeEnvelope) => realtime.push(e));
    paired = await pair('test-mac');
    const gitOps = await createSkill(dataSource, me.workspaceId, {
      slug: 'git-ops',
      name: 'Git ops',
      description: 'Use for git work.',
      content: '# Git ops',
      version: 3,
    });
    const summarize = await createSkill(dataSource, me.workspaceId, {
      slug: 'summarize',
      name: 'Summarize',
      description: 'Use to summarize.',
      content: '# Summarize',
    });
    await createSkill(dataSource, me.workspaceId, {
      slug: 'translate',
      name: 'Translate',
      description: 'Use to translate.',
      content: '# Translate',
    });
    agent = await createAgent(dataSource, me.workspaceId, paired.computerId, {
      name: 'Claude',
      skills: [summarize.id, gitOps.id],
    });
  });

  // ---------- helpers ----------
  const http = () => request(app.getHttpServer());
  const api = (path: string) => `/api/v1${path}`;

  const pairingCode = async (client = me): Promise<string> => {
    const res = await http().post(api('/computers/pairing-codes')).set(client.bearer).expect(200);
    return (res.body as ApiResponse<{ code: string }>).data.code;
  };

  async function pair(name: string): Promise<Paired> {
    const code = await pairingCode();
    const res = await http()
      .post(api('/gateway/pair'))
      .send({ code, name, os: 'macOS 26.1 · arm64', cliVersion: '0.1.0' })
      .expect(200);
    const data = (res.body as ApiResponse<{ computerId: string; apiKey: string }>).data;
    return {
      computerId: data.computerId,
      apiKey: data.apiKey,
      key: { Authorization: `Bearer ${data.apiKey}` },
    };
  }

  const gw = async <T>(
    path: string,
    body: object,
    status = 200,
    who: Paired = paired,
    headers: Record<string, string> = {},
  ): Promise<T> => {
    const res = await http()
      .post(api(`/gateway${path}`))
      .set(who.key)
      .set(headers)
      .send(body);
    expect(res.status).toBe(status);
    return (res.body as ApiResponse<T>).data;
  };
  const gwError = async (
    path: string,
    body: object,
    status: number,
    who: Paired = paired,
    headers: Record<string, string> = {},
  ): Promise<string> => {
    const res = await http()
      .post(api(`/gateway${path}`))
      .set(who.key)
      .set(headers)
      .send(body);
    expect(res.status).toBe(status);
    return (res.body as ApiResponse<null>).message;
  };

  const call = async <T>(
    method: 'get' | 'post' | 'put' | 'patch' | 'delete',
    path: string,
    body?: object,
    client = me,
    status = 200,
  ): Promise<T> => {
    const res = await http()[method](api(path)).set(client.bearer).send(body);
    expect(res.status).toBe(status);
    return (res.body as ApiResponse<T>).data;
  };

  const dmOf = async (a: Agent, client = member): Promise<string> =>
    (await call<{ chatId: string }>('post', `/agents/${a.id}/dm`, undefined, client)).chatId;
  const sendChat = (chatId: string, markdown: string, client = member) =>
    call<Message>('post', `/chats/${chatId}/messages`, { markdown }, client);
  const messagesOf = (chatId: string, client = member) =>
    call<Message[]>('get', `/chats/${chatId}/messages`, undefined, client);
  const lastReply = async (chatId: string): Promise<Message> => {
    const all = await messagesOf(chatId);
    return all.filter((m) => m.author.kind === 'agent').at(-1)!;
  };

  const tool = (name: string, assignmentId: string, input: object = {}, status = 200) =>
    gw<{ result: unknown }>(`/tools/${name}`, input, status, paired, {
      'X-Assignment-Id': assignmentId,
    });
  const toolError = (name: string, assignmentId: string, input: object, status: number) =>
    gwError(`/tools/${name}`, input, status, paired, { 'X-Assignment-Id': assignmentId });

  /** A DM message from `client` claimed and accepted: a running chat assignment. */
  const runningChat = async (text = 'hello', client = member) => {
    const chatId = await dmOf(agent, client);
    await sendChat(chatId, text, client);
    const claimed = (await gw<Claimed | null>('/claim', { maxChats: 3 }))!;
    await gw('/assignments/' + claimed.id + '/accept', { attempt: claimed.attempt });
    return { chatId, claimed };
  };

  const settle = async () => {
    await engine.settled();
    await sleep(30);
    await engine.settled();
  };
  const taskOf = (id: string) =>
    call<Task[]>('get', '/tasks').then((all) => all.find((t) => t.id === id)!);

  // ---------- pairing ----------
  describe('pairing', () => {
    it('creates a single-use code and exchanges it for a computer and its API key', async () => {
      const res = await http().post(api('/computers/pairing-codes')).set(me.bearer).expect(200);
      const { code, expiresAt } = (res.body as ApiResponse<{ code: string; expiresAt: string }>)
        .data;
      expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
      expect(Date.parse(expiresAt) - clock.now().getTime()).toBeGreaterThan(9 * 60_000);
      expect(Date.parse(expiresAt) - clock.now().getTime()).toBeLessThanOrEqual(10 * 60_000);
      const [row] = (await dataSource.query('SELECT * FROM pairing_codes')) as Record<
        string,
        unknown
      >[];
      expect(JSON.stringify(row)).not.toContain(code);
      expect(row.code_hash).toMatch(/^[0-9a-f]{64}$/);

      // case and the dash do not matter
      const paired2 = await http()
        .post(api('/gateway/pair'))
        .send({
          code: code.toLowerCase().replace('-', ' '),
          name: 'box',
          os: 'Linux',
          cliVersion: '1',
        })
        .expect(200);
      const data = (
        paired2.body as ApiResponse<{
          computerId: string;
          apiKey: string;
          workspace: { id: string; name: string; slug: string };
        }>
      ).data;
      expect(data.apiKey).toMatch(/^agk_/);
      expect(data.workspace).toMatchObject({ id: me.workspaceId });
      const computer = await dataSource
        .getRepository(Computer)
        .findOneByOrFail({ id: data.computerId });
      expect(computer).toMatchObject({
        name: 'box',
        status: 'online',
        simulated: false,
        workspaceId: me.workspaceId,
        cliVersion: '1',
      });
      // the key is only stored hashed and never listed
      const listed = await call<Record<string, unknown>[]>('get', '/computers');
      expect(JSON.stringify(listed)).not.toContain(data.apiKey);
      expect(JSON.stringify(listed)).not.toContain('apiKey');
      expect(listed.map((c) => c.id)).toContain(data.computerId);
    });

    it('rejects a reused, unknown or expired code', async () => {
      const code = await pairingCode();
      const body = { code, name: 'a', os: 'b', cliVersion: 'c' };
      await http().post(api('/gateway/pair')).send(body).expect(200);
      const reuse = await http().post(api('/gateway/pair')).send(body).expect(401);
      expect((reuse.body as ApiResponse<null>).message).toBe(
        'The pairing code is invalid, expired or already used',
      );
      await http()
        .post(api('/gateway/pair'))
        .send({ ...body, code: 'ZZZZ-ZZZZ' })
        .expect(401);

      const old = await pairingCode();
      clock.advance(10 * 60_000 + 1000);
      await http()
        .post(api('/gateway/pair'))
        .send({ ...body, code: old })
        .expect(401);
    });

    it('validates the pair body and limits who may create codes', async () => {
      await http().post(api('/gateway/pair')).send({ code: 'ABCD-EFGH' }).expect(400);
      await http().post(api('/computers/pairing-codes')).set(member.bearer).expect(403);
      await http().post(api('/computers/pairing-codes')).expect(401);
      const admin = await addMemberWithRole(dataSource, me, 'admin');
      await http().post(api('/computers/pairing-codes')).set(admin.bearer).expect(200);
    });
  });

  // ---------- computer auth ----------
  describe('computer API key auth', () => {
    it('rejects a missing, malformed, unknown or JWT credential', async () => {
      const heartbeat = () => http().post(api('/gateway/heartbeat')).send({});
      await heartbeat().expect(401);
      await heartbeat().set({ Authorization: 'Bearer agk_nope' }).expect(401);
      await heartbeat()
        .set({ Authorization: `Basic ${paired.apiKey}` })
        .expect(401);
      const jwt = await heartbeat().set(me.bearer).expect(401);
      expect((jwt.body as ApiResponse<null>).message).toBe('Invalid or revoked computer API key');
      await http().post(api('/gateway/claim')).send({}).expect(401);
      await http().post(api('/gateway/tools/list_agents')).send({}).expect(401);
    });

    it('does not take an API key for a member session', async () => {
      await http().get(api('/tasks')).set(paired.key).expect(401);
    });

    it('answers a heartbeat with the computer agents and brings it online', async () => {
      await dataSource
        .getRepository(Computer)
        .update({ id: paired.computerId }, { status: 'offline' });
      const data = await gw<{ agents: Array<Record<string, unknown>> }>('/heartbeat', {
        cliVersion: '9.9.9',
      });
      expect(data).toMatchObject({ cancelled: [] });
      expect(data.agents).toEqual([
        {
          id: agent.id,
          name: 'Claude',
          persona: 'Be helpful.',
          workdir: '~/workspace',
          maxTurns: 40,
          skills: ['git-ops', 'summarize'],
          // no skillDefs: skill content only travels with a claimed assignment
        },
      ]);
      const computer = await dataSource
        .getRepository(Computer)
        .findOneByOrFail({ id: paired.computerId });
      expect(computer).toMatchObject({ status: 'online', cliVersion: '9.9.9' });
      expect(realtime.some((e) => e.event.type === 'computers.changed')).toBe(true);
      await gw('/heartbeat', {});
    });
  });

  // ---------- chat ----------
  describe('chat reply over HTTP', () => {
    it('offers a real computer reply immediately; a simulated one stays pending', async () => {
      const chatId = await dmOf(agent);
      const sent = await sendChat(chatId, 'hi there');
      expect(sent.status).toBe('complete');
      expect((await lastReply(chatId)).assignment).toMatchObject({ status: 'offered' });

      const simComputer = await createComputer(dataSource, me.workspaceId, { simulated: true });
      const simAgent = await createAgent(dataSource, me.workspaceId, simComputer.id, {
        name: 'Sim',
      });
      const simChat = await dmOf(simAgent);
      await sendChat(simChat, 'hi');
      expect((await lastReply(simChat)).assignment).toMatchObject({ status: 'pending' });
    });

    it('runs claim -> accept -> progress -> result and streams only to the DM owner', async () => {
      const chatId = await dmOf(agent);
      await sendChat(chatId, 'Chào Claude, giúp mình với');
      const placeholder = await lastReply(chatId);
      realtime = [];

      expect(await gw('/claim', { maxChats: 0 })).toBeNull();
      const claimed = (await gw<Claimed | null>('/claim', { maxChats: 3 }))!;
      expect(claimed).toMatchObject({
        id: placeholder.assignment!.id,
        attempt: 1,
        kind: 'chat',
        prompt: 'Chào Claude, giúp mình với',
        leaseMs: LEASE_MS,
        requestedBy: { id: member.memberId, name: 'Extra member', role: 'member' },
        agent: {
          id: agent.id,
          name: 'Claude',
          skills: ['git-ops', 'summarize'],
          skillDefs: [
            expect.objectContaining({ slug: 'git-ops', content: '# Git ops', version: 3 }),
            expect.objectContaining({ slug: 'summarize', content: '# Summarize', version: 1 }),
          ],
        },
      });
      expect(claimed.session).toEqual({ id: expect.stringMatching(UUID), resume: false });
      expect(claimed.context).toContain('direct message with Extra member');
      expect(claimed.context).toContain('Requested by: Extra member (member)');
      expect(await gw('/claim', { maxChats: 3 })).toBeNull();

      await gw(`/assignments/${claimed.id}/accept`, { attempt: claimed.attempt });
      expect((await lastReply(chatId)).assignment).toMatchObject({ status: 'running' });

      const started = Date.now();
      await gw(`/assignments/${claimed.id}/progress`, {
        attempt: 1,
        events: [
          { kind: 'turns', turns: 1 },
          {
            kind: 'tool',
            call: { id: 't1', name: 'list_tasks', input: '{}', output: null, status: 'running' },
          },
          { kind: 'text', delta: 'Xin ' },
        ],
      });
      for (const delta of ['chào', ' bạn', ', mình', ' đây']) {
        await gw(`/assignments/${claimed.id}/progress`, {
          attempt: 1,
          events: [{ kind: 'text', delta }],
        });
      }
      await gw(`/assignments/${claimed.id}/progress`, {
        attempt: 1,
        events: [
          {
            kind: 'tool',
            call: { id: 't1', name: 'list_tasks', input: '{}', output: '[]', status: 'ok' },
          },
        ],
      });
      await sleep(250);
      const elapsed = Date.now() - started;

      // text lives in memory: the row is empty while streaming
      const row = await dataSource
        .getRepository(ChatMessage)
        .findOneByOrFail({ id: placeholder.id });
      expect(row).toMatchObject({ markdown: '', status: 'streaming' });
      const frames = realtime.filter(
        (e): e is RealtimeEnvelope & { event: { type: 'message.upserted'; message: Message } } =>
          e.event.type === 'message.upserted' && e.event.message.id === placeholder.id,
      );
      expect(frames.length).toBeGreaterThan(0);
      // targeted at the DM owner only, never the workspace
      for (const frame of frames) expect(frame.memberIds).toEqual([member.memberId]);
      const streamed = frames.map((f) => f.event.message.markdown).filter(Boolean);
      expect(streamed.at(-1)).toBe('Xin chào bạn, mình đây');
      const textFrames = frames.filter(
        (f) => f.event.message.status === 'streaming' && f.event.message.markdown,
      );
      expect(textFrames.length).toBeLessThanOrEqual(Math.ceil(elapsed / 100) + 2);
      const withTool = frames
        .map((f) => f.event.message.assignment!.toolCalls)
        .filter((t) => t.length);
      expect(withTool.at(-1)).toEqual([
        { id: 't1', name: 'list_tasks', input: '{}', output: '[]', status: 'ok' },
      ]);
      expect(frames.at(-1)!.event.message.assignment!.turns).toBe(1);

      const sessionId = '6f1c2f4e-9d2a-4b64-8f7e-0b5a2d9f3c11';
      await gw(`/assignments/${claimed.id}/result`, {
        attempt: 1,
        status: 'completed',
        text: 'Xin chào bạn, mình đây.',
        sessionId,
        numTurns: 2,
        costUsd: 0.0123,
      });
      const done = await lastReply(chatId);
      expect(done).toMatchObject({
        status: 'complete',
        markdown: 'Xin chào bạn, mình đây.',
        assignment: { status: 'completed', turns: 2, error: null },
      });
      const assignment = await dataSource
        .getRepository(Assignment)
        .findOneByOrFail({ id: claimed.id });
      expect(assignment).toMatchObject({ numTurns: 2, costUsd: 0.0123, status: 'completed' });
      const finalFrame = realtime
        .filter((e) => e.event.type === 'message.upserted' && e.event.message.id === placeholder.id)
        .at(-1)!;
      expect(finalFrame.memberIds).toEqual([member.memberId]);
      expect(finalFrame.event).toMatchObject({ message: { status: 'complete' } });
      // the owner of the workspace cannot read the member's DM
      await call('get', `/chats/${chatId}/messages`, undefined, me, 404);
      expect(
        await dataSource.getRepository(AgentActivity).findOneByOrFail({ agentId: agent.id }),
      ).toMatchObject({ status: 'completed', request: 'Tin nhắn riêng (DM)' });

      // idempotent per (id, attempt)
      await gw(`/assignments/${claimed.id}/result`, {
        attempt: 1,
        status: 'completed',
        text: 'Xin chào bạn, mình đây.',
      });
      expect(await dataSource.getRepository(AgentActivity).count()).toBe(1);

      // the next message of the chat resumes the session
      await sendChat(chatId, 'tiếp nhé');
      const second = (await gw<Claimed | null>('/claim', { maxChats: 3 }))!;
      expect(second.session).toEqual({ id: sessionId, resume: true });
      expect(second.context).toContain('Xin chào bạn, mình đây.');
      // a different chat does not
      const other = await dmOf(agent, me);
      await sendChat(other, 'khác', me);
      const third = (await gw<Claimed | null>('/claim', { maxChats: 3 }))!;
      expect(third.session.resume).toBe(false);
      expect(third.requestedBy).toMatchObject({ id: me.memberId, role: 'owner' });
    });

    it('keeps the streamed text when the result carries none, and fails on a failed result', async () => {
      const { chatId, claimed } = await runningChat('first');
      await gw(`/assignments/${claimed.id}/progress`, {
        attempt: 1,
        events: [{ kind: 'text', delta: 'partial answer' }],
      });
      await gw(`/assignments/${claimed.id}/result`, { attempt: 1, status: 'completed' });
      expect(await lastReply(chatId)).toMatchObject({
        status: 'complete',
        markdown: 'partial answer',
      });

      await sendChat(chatId, 'second');
      const second = (await gw<Claimed | null>('/claim', { maxChats: 3 }))!;
      await gw(`/assignments/${second.id}/accept`, { attempt: 1 });
      await gw(`/assignments/${second.id}/progress`, {
        attempt: 1,
        events: [{ kind: 'text', delta: 'half' }],
      });
      await gw(`/assignments/${second.id}/result`, {
        attempt: 1,
        status: 'failed',
        error: 'daemon stopped',
        numTurns: 1,
      });
      const failed = await lastReply(chatId);
      expect(failed).toMatchObject({
        status: 'failed',
        markdown: 'half',
        assignment: { status: 'failed', error: 'daemon stopped', turns: 1 },
      });
      expect(
        await dataSource.getRepository(AgentActivity).count({ where: { status: 'failed' } }),
      ).toBe(1);
      // a different report of the same attempt conflicts
      await gw(`/assignments/${second.id}/result`, { attempt: 1, status: 'completed' }, 409);
      await gw(`/assignments/${second.id}/result`, { attempt: 1, status: 'failed', error: 'x' });
    });

    it('never writes text or status into a reply that was deleted meanwhile', async () => {
      const { claimed } = await runningChat('first');
      await gw(`/assignments/${claimed.id}/progress`, {
        attempt: 1,
        events: [{ kind: 'text', delta: 'streamed' }],
      });
      const reply = await dataSource
        .getRepository(ChatMessage)
        .findOneByOrFail({ assignmentId: claimed.id });
      // deleted behind the run's back (no cancel): the result must leave the placeholder alone
      await dataSource.query(
        `UPDATE messages SET markdown = '', deleted_at = now() WHERE id = $1`,
        [reply.id],
      );
      await gw(`/assignments/${claimed.id}/result`, {
        attempt: 1,
        status: 'completed',
        text: 'too late',
      });
      expect(
        await dataSource.getRepository(ChatMessage).findOneByOrFail({ id: reply.id }),
      ).toMatchObject({ markdown: '', status: 'streaming' });
      const frames = realtime.filter(
        (e) => e.event.type === 'message.upserted' && e.event.message.id === reply.id,
      );
      for (const frame of frames.slice(-1)) {
        expect(frame.event).toMatchObject({ message: { markdown: '', deleted: true } });
      }
    });

    it('rejects stale attempts and progress before accept', async () => {
      const chatId = await dmOf(agent);
      await sendChat(chatId, 'hello');
      const claimed = (await gw<Claimed | null>('/claim', { maxChats: 3 }))!;
      await gw(`/assignments/${claimed.id}/progress`, { attempt: 1, events: [] }, 409);
      await gw(`/assignments/${claimed.id}/accept`, { attempt: 7 }, 409);
      await gw(`/assignments/${claimed.id}/accept`, { attempt: 1 });
      await gw(`/assignments/${claimed.id}/progress`, { attempt: 2, events: [] }, 409);
      await gw(`/assignments/${claimed.id}/result`, { attempt: 2, status: 'completed' }, 409);
      await gw(`/assignments/${claimed.id}/progress`, { attempt: 1, events: 'nope' }, 400);
      // garbled events are skipped, not fatal
      await gw(`/assignments/${claimed.id}/progress`, {
        attempt: 1,
        events: [{ kind: 'nope' }, { kind: 'tool', call: { id: 1 } }, { kind: 'turns', turns: -1 }],
      });
    });
  });

  // ---------- tasks ----------
  describe('task run over HTTP', () => {
    const startTask = async (title = 'Viết tài liệu', status: 'doing' | 'todo' = 'doing') => {
      const task = await call<Task>('post', '/tasks', {
        title,
        description: 'Ghi lại cách deploy',
        assigneeId: agent.id,
        status,
      });
      await settle();
      return task.id;
    };

    it('records the tool calls as steps and finishes the task into review', async () => {
      const id = await startTask();
      expect(await taskOf(id)).toMatchObject({ status: 'doing', activeRun: { steps: [] } });

      const claimed = (await gw<Claimed | null>('/claim', { maxChats: 0 }))!;
      expect(claimed).toMatchObject({
        kind: 'task',
        requestedBy: { id: me.memberId, role: 'owner' },
        agent: { id: agent.id },
      });
      expect(claimed.prompt).toContain(`# Task ${id}: Viết tài liệu`);
      expect(claimed.prompt).toContain('Ghi lại cách deploy');
      expect(claimed.session.resume).toBe(false);
      expect(claimed.context).toContain('Requested by:');
      await gw(`/assignments/${claimed.id}/accept`, { attempt: 1 });

      const toolEvent = (callId: string, name: string, status: string) => ({
        kind: 'tool',
        call: { id: callId, name, input: `{"n":"${callId}"}`, output: null, status },
      });
      await gw(`/assignments/${claimed.id}/progress`, {
        attempt: 1,
        events: [toolEvent('a', 'Read', 'running'), toolEvent('b', 'Write', 'running')],
      });
      // the later report of a known call only updates it
      await gw(`/assignments/${claimed.id}/progress`, {
        attempt: 1,
        events: [toolEvent('a', 'Read', 'ok'), { kind: 'turns', turns: 2 }],
      });
      await settle();
      const running = await taskOf(id);
      expect(running.activeRun).toMatchObject({
        step: 2,
        steps: [
          { tool: 'Read', input: '{"n":"a"}' },
          { tool: 'Write', input: '{"n":"b"}' },
        ],
      });
      const assignment = await dataSource
        .getRepository(Assignment)
        .findOneByOrFail({ id: claimed.id });
      expect(assignment).toMatchObject({ toolCalls: 2, turns: 2 });
      expect(assignment.toolLog.map((t) => t.status)).toEqual(['ok', 'running']);

      await gw(`/assignments/${claimed.id}/result`, {
        attempt: 1,
        status: 'completed',
        text: 'Đã viết xong docs/deploy.md',
        sessionId: '0b5a2d9f-3c11-4b64-8f7e-6f1c2f4e9d2a',
        numTurns: 3,
        costUsd: 0.5,
      });
      await settle();
      const done = await taskOf(id);
      expect(done).toMatchObject({
        status: 'review',
        output: 'Đã viết xong docs/deploy.md',
        activeRun: null,
        runs: [{ n: 1, status: 'completed', toolCalls: 2 }],
      });

      // retry resumes the task's session
      await call('post', `/tasks/${id}/revise`, { note: 'thêm phần rollback' });
      await settle();
      const again = (await gw<Claimed | null>('/claim', { maxChats: 0 }))!;
      expect(again.session).toEqual({
        id: '0b5a2d9f-3c11-4b64-8f7e-6f1c2f4e9d2a',
        resume: true,
      });
      expect(again.prompt).toContain('thêm phần rollback');
    });

    it('sends a failed run back to todo with the daemon error', async () => {
      const id = await startTask();
      const claimed = (await gw<Claimed | null>('/claim', { maxChats: 0 }))!;
      await gw(`/assignments/${claimed.id}/accept`, { attempt: 1 });
      await gw(`/assignments/${claimed.id}/progress`, {
        attempt: 1,
        events: [
          {
            kind: 'tool',
            call: { id: 'x', name: 'Bash', input: '{}', output: null, status: 'running' },
          },
        ],
      });
      await gw(`/assignments/${claimed.id}/result`, {
        attempt: 1,
        status: 'failed',
        error: 'daemon stopped',
      });
      await settle();
      expect(await taskOf(id)).toMatchObject({
        status: 'todo',
        error: 'Run #1 lỗi ở Bash',
        runs: [{ status: 'failed', error: 'daemon stopped' }],
      });
    });

    it('runs queued tasks one per agent and falls back to the creator as requester', async () => {
      const first = await startTask('Một');
      const second = await startTask('Hai', 'todo');
      expect((await taskOf(second)).status).toBe('todo');
      const claimed = (await gw<Claimed | null>('/claim', { maxChats: 0 }))!;
      expect(claimed.prompt).toContain(first);
      // one run per agent: the second is not offered while the first runs
      expect(await gw('/claim', { maxChats: 0 })).toBeNull();
      expect(
        await dataSource.getRepository(TaskEntity).findOneByOrFail({ id: first }),
      ).toMatchObject({
        createdByMemberId: me.memberId,
      });
    });

    it('surfaces a stop on heartbeat and progress, and drops the late result', async () => {
      const id = await startTask();
      const claimed = (await gw<Claimed | null>('/claim', { maxChats: 0 }))!;
      await gw(`/assignments/${claimed.id}/accept`, { attempt: 1 });
      expect(await gw(`/assignments/${claimed.id}/heartbeat`, { attempt: 1 })).toEqual({
        ok: true,
        cancelled: false,
      });
      await call('post', `/tasks/${id}/stop`);
      await settle();
      expect(await gw(`/assignments/${claimed.id}/heartbeat`, { attempt: 1 })).toEqual({
        ok: true,
        cancelled: true,
      });
      expect(
        await gw(`/assignments/${claimed.id}/progress`, {
          attempt: 1,
          events: [{ kind: 'turns', turns: 1 }],
        }),
      ).toEqual({ ok: true, cancelled: true });
      // a late result after a stop is acknowledged and dropped (no write)
      expect(
        await gw(`/assignments/${claimed.id}/result`, { attempt: 1, status: 'completed' }),
      ).toEqual({ ok: true });
      expect(await taskOf(id)).toMatchObject({ status: 'todo', error: 'Đã dừng thủ công' });
      // the computer heartbeat names it too, filtered to the ids the daemon reports
      expect(await gw('/heartbeat', { running: [claimed.id] })).toMatchObject({
        cancelled: [claimed.id],
      });
      expect(await gw('/heartbeat', { running: [] })).toMatchObject({ cancelled: [] });
      expect(await gw('/heartbeat', {})).toMatchObject({ cancelled: [claimed.id] });
    });

    it('cancels a chat reply when its agent is deleted', async () => {
      const { chatId, claimed } = await runningChat();
      await call('delete', `/agents/${agent.id}`);
      expect(await gw(`/assignments/${claimed.id}/heartbeat`, { attempt: 1 })).toEqual({
        ok: true,
        cancelled: true,
      });
      await call('get', `/chats/${chatId}/messages`, undefined, member, 404);
    });
  });

  // ---------- lease ----------
  describe('lease', () => {
    it('expires a silent run, which then reads as cancelled', async () => {
      const { claimed } = await runningChat();
      expect(await gw(`/assignments/${claimed.id}/heartbeat`, { attempt: 1 })).toEqual({
        ok: true,
        cancelled: false,
      });
      clock.advance(LEASE_MS + 1000);
      expect(await gateway.reconcileLeases(clock.now())).toBe(1);
      expect(await gw(`/assignments/${claimed.id}/heartbeat`, { attempt: 1 })).toEqual({
        ok: true,
        cancelled: true,
      });
      expect(
        await gw(`/assignments/${claimed.id}/result`, { attempt: 1, status: 'completed' }),
      ).toEqual({ ok: true });
    });

    it('renews the lease on each heartbeat', async () => {
      const { claimed } = await runningChat();
      clock.advance(LEASE_MS - 5000);
      await gw(`/assignments/${claimed.id}/heartbeat`, { attempt: 1 });
      clock.advance(LEASE_MS - 5000);
      expect(await gateway.reconcileLeases(clock.now())).toBe(0);
    });
  });

  // ---------- isolation ----------
  describe('another computer', () => {
    it('cannot touch the assignment or run its tools', async () => {
      const { claimed } = await runningChat();
      const other = await pair('other-box');
      const id = claimed.id;
      await gw(`/assignments/${id}/accept`, { attempt: 1 }, 404, other);
      await gw(`/assignments/${id}/heartbeat`, { attempt: 1 }, 404, other);
      await gw(`/assignments/${id}/progress`, { attempt: 1, events: [] }, 404, other);
      await gw(`/assignments/${id}/result`, { attempt: 1, status: 'completed' }, 404, other);
      await gw('/tools/list_agents', {}, 404, other, { 'X-Assignment-Id': id });
      expect(await gw('/claim', { maxChats: 3 }, 200, other)).toBeNull();
      // and the owner computer still can
      await gw(`/assignments/${id}/heartbeat`, { attempt: 1 });
    });

    it('also cannot reach an assignment of another workspace', async () => {
      const { claimed } = await runningChat();
      const stranger = await registerAndLogin(app);
      const code = await pairingCode(stranger);
      const res = await http()
        .post(api('/gateway/pair'))
        .send({ code, name: 'x', os: 'y', cliVersion: 'z' })
        .expect(200);
      const data = (res.body as ApiResponse<{ computerId: string; apiKey: string }>).data;
      const foreign: Paired = {
        computerId: data.computerId,
        apiKey: data.apiKey,
        key: { Authorization: `Bearer ${data.apiKey}` },
      };
      await gw(`/assignments/${claimed.id}/heartbeat`, { attempt: 1 }, 404, foreign);
      await gw('/tools/list_members', {}, 404, foreign, { 'X-Assignment-Id': claimed.id });
    });
  });

  // ---------- tools ----------
  describe('workspace tools', () => {
    it('reads agents, tasks and members', async () => {
      const task = await call<Task>('post', '/tasks', { title: 'Báo cáo', status: 'backlog' });
      const { claimed } = await runningChat();
      const id = claimed.id;

      const agents = (await tool('list_agents', id)).result as Array<{
        id: string;
        skills: string[];
      }>;
      expect(agents).toEqual([
        expect.objectContaining({
          id: agent.id,
          skills: ['git-ops', 'summarize'],
          status: 'working',
        }),
      ]);
      expect((await tool('list_skills', id)).result).toEqual([
        { slug: 'git-ops', name: 'Git ops', description: 'Use for git work.' },
        { slug: 'summarize', name: 'Summarize', description: 'Use to summarize.' },
        { slug: 'translate', name: 'Translate', description: 'Use to translate.' },
      ]);
      const tasks = (await tool('list_tasks', id, { status: 'backlog' })).result as Array<{
        id: string;
      }>;
      expect(tasks.map((t) => t.id)).toEqual([task.id]);
      expect(((await tool('list_tasks', id, { status: 'done' })).result as unknown[]).length).toBe(
        0,
      );
      expect(
        ((await tool('get_task', id, { id: task.id })).result as { title: string }).title,
      ).toBe('Báo cáo');
      const members = (await tool('list_members', id)).result as Array<{
        name: string;
        role: string;
      }>;
      expect(members.map((m) => m.role).sort()).toEqual(['member', 'owner']);
      expect(JSON.stringify(members)).not.toContain('@');
      await toolError('get_task', id, { id: 'AG-999' }, 400);
      expect(await toolError('list_tasks', id, { status: 'nope' }, 400)).toContain(
        'Invalid tool input',
      );
      expect(await toolError('nope', id, {}, 404)).toBe('Unknown tool nope');
    });

    it('list_skills is member-level, workspace-scoped and not a write call', async () => {
      const stranger = await registerAndLogin(app);
      await createSkill(dataSource, stranger.workspaceId, {
        slug: 'foreign',
        name: 'Foreign',
        description: 'Other workspace.',
        content: '# Foreign',
      });
      const { claimed } = await runningChat('ai đó', member);
      for (let i = 0; i < MAX_WRITE_CALLS + 5; i++) {
        const slugs = ((await tool('list_skills', claimed.id)).result as Array<{ slug: string }>)
          .map((s) => s.slug)
          .sort();
        expect(slugs).toEqual(['git-ops', 'summarize', 'translate']);
      }
      // the write budget is untouched: a write tool still works after all those reads
      await tool('create_task', claimed.id, { title: 'Vẫn ghi được', status: 'backlog' });
    });

    it('update_agent rejects unknown skill slugs and leaves the agent unchanged', async () => {
      const ownerChat = await dmOf(agent, me);
      await sendChat(ownerChat, 'đổi skill', me);
      const run = (await gw<Claimed | null>('/claim', { maxChats: 3 }))!;
      await gw(`/assignments/${run.id}/accept`, { attempt: 1 });
      const before = await dataSource.getRepository(Agent).findOneByOrFail({ id: agent.id });
      const message = await toolError(
        'update_agent',
        run.id,
        { id: agent.id, skills: ['git-ops', 'nope'] },
        400,
      );
      expect(message).toContain('unknown skills: nope');
      const after = await dataSource.getRepository(Agent).findOneByOrFail({ id: agent.id });
      expect(after.skills).toEqual(before.skills);
    });

    it('writes as the requester and attributes every write to the agent', async () => {
      const { chatId, claimed } = await runningChat('làm giúp mình');
      const id = claimed.id;

      const created = (
        await tool('create_task', id, {
          title: 'Dọn backlog',
          description: 'mô tả',
          priority: 'high',
          assigneeId: member.memberId,
          requiresReview: false,
        })
      ).result as { id: string; priority: string; assigneeId: string };
      expect(created).toMatchObject({ priority: 'high', assigneeId: member.memberId });
      const row = await dataSource.getRepository(TaskEntity).findOneByOrFail({ id: created.id });
      expect(row).toMatchObject({ createdByMemberId: member.memberId, requiresReview: false });
      const log = async () =>
        dataSource.getRepository(TaskActivityRow).find({
          where: { taskId: created.id },
          order: { at: 'ASC', seq: 'ASC' },
        });
      expect((await log())[0]).toMatchObject({
        by: agent.id,
        text: '(thay Extra member) tạo task',
      });

      await tool('update_task', id, {
        id: created.id,
        priority: 'urgent',
        subtasks: [{ title: 'một' }, { title: 'hai', done: true }],
      });
      await tool('move_task', id, { id: created.id, status: 'backlog' });
      await tool('comment_task', id, { id: created.id, markdown: 'đã xem' });
      const entries = await log();
      expect(entries.every((e) => e.by === agent.id)).toBe(true);
      expect(entries.map((e) => e.text)).toEqual(
        expect.arrayContaining([
          expect.stringContaining('(thay Extra member) đổi ưu tiên'),
          expect.stringContaining('(thay Extra member) chuyển sang'),
          '(thay Extra member) đã xem',
        ]),
      );
      expect(entries.find((e) => e.text.endsWith('đã xem'))!.kind).toBe('comment');
      expect(
        (await dataSource.getRepository(TaskEntity).findOneByOrFail({ id: created.id })).subtasks,
      ).toEqual([
        { title: 'một', done: false },
        { title: 'hai', done: true },
      ]);

      // post_message defaults to the assignment's own chat, authored by the agent, no reply
      const before = await dataSource.getRepository(Assignment).count();
      realtime = [];
      await tool('post_message', id, { markdown: 'Xong rồi nhé' });
      const posted = (await messagesOf(chatId)).filter((m) => m.markdown === 'Xong rồi nhé');
      expect(posted).toHaveLength(1);
      expect(posted[0]).toMatchObject({
        author: { kind: 'agent', id: agent.id },
        status: 'complete',
      });
      expect(await dataSource.getRepository(Assignment).count()).toBe(before);
      const frame = realtime.find(
        (e) => e.event.type === 'message.upserted' && e.event.message.id === posted[0].id,
      )!;
      expect(frame.memberIds).toEqual([member.memberId]);

      // somebody else's DM is invisible to the requester
      const others = await dmOf(agent, me);
      await toolError('post_message', id, { chatId: others, markdown: 'psst' }, 400);
      await toolError('post_message', id, { markdown: '   ' }, 400);
    });

    it('limits agent management to owner/admin requesters and re-checks the role', async () => {
      const { claimed } = await runningChat('tạo agent', member);
      expect(await toolError('create_agent', claimed.id, { name: 'Hằng' }, 403)).toBe(
        'You do not have permission to do this',
      );
      await toolError('update_agent', claimed.id, { id: agent.id, persona: 'x' }, 403);

      const ownerChat = await dmOf(agent, me);
      await sendChat(ownerChat, 'tạo agent Hằng phụ trách kinh doanh', me);
      const second = (await gw<Claimed | null>('/claim', { maxChats: 3 }))!;
      await gw(`/assignments/${second.id}/accept`, { attempt: 1 });
      const created = (
        await tool('create_agent', second.id, {
          name: 'Hằng',
          persona: 'Phụ trách kinh doanh',
          skills: ['summarize', 'translate'],
          maxTurns: 12,
        })
      ).result as { id: string; computerId: string; skills: string[]; workdir: string };
      expect(created).toMatchObject({
        computerId: paired.computerId,
        skills: ['summarize', 'translate'],
        workdir: expect.stringMatching(/^~\/\.agent\/agents\//),
      });
      expect(
        await dataSource.getRepository(Agent).findOneByOrFail({ id: created.id }),
      ).toMatchObject({
        name: 'Hằng',
        persona: 'Phụ trách kinh doanh',
        maxTurns: 12,
        computerId: paired.computerId,
      });
      expect(await toolError('create_agent', second.id, { name: 'hằng' }, 400)).toBe(
        'An agent with this name already exists',
      );
      await toolError('create_agent', second.id, { name: 'X', maxTurns: 999 }, 400);
      await toolError('create_agent', second.id, { name: 'Y', skills: ['nope'] }, 400);

      const updated = (
        await tool('update_agent', second.id, {
          id: created.id,
          persona: 'Mới',
          skills: ['git-ops'],
          workdir: 'hang',
        })
      ).result as { skills: string[]; workdir: string };
      expect(updated).toMatchObject({
        skills: ['git-ops'],
        workdir: '~/.agent/agents/hang',
      });
      const activity = await dataSource
        .getRepository(AgentActivity)
        .find({ where: { agentId: agent.id }, order: { at: 'ASC' } });
      expect(activity.map((a) => a.request)).toEqual([
        expect.stringContaining('(thay '),
        expect.stringContaining('(thay '),
      ]);

      // a demoted requester loses the admin tools at once
      await dataSource.query(`UPDATE members SET role = 'member' WHERE id = $1`, [me.memberId]);
      await toolError('create_agent', second.id, { name: 'Another' }, 403);
    });

    it('create_agent / update_agent set department and title, and list tools show them', async () => {
      const dept = await call<{ id: string }>('post', '/departments', { name: 'Kinh doanh' });
      const foreignOwner = await registerAndLogin(app);
      const foreignDept = await call<{ id: string }>(
        'post',
        '/departments',
        { name: 'Kinh doanh' },
        foreignOwner,
      );
      const memberRun = await runningChat('tạo agent', member);
      await toolError(
        'create_agent',
        memberRun.claimed.id,
        { name: 'Nope', departmentId: dept.id, title: 'x' },
        403,
      );
      await toolError(
        'update_agent',
        memberRun.claimed.id,
        { id: agent.id, departmentId: dept.id },
        403,
      );

      const ownerChat = await dmOf(agent, me);
      await sendChat(ownerChat, 'tạo agent', me);
      const run = (await gw<Claimed | null>('/claim', { maxChats: 3 }))!;
      await gw(`/assignments/${run.id}/accept`, { attempt: 1 });

      const created = (
        await tool('create_agent', run.id, {
          name: 'Hằng',
          departmentId: dept.id,
          title: ' Trợ \n lý\u0007 ',
        })
      ).result as { id: string; departmentId: string | null; title: string | null };
      expect(created).toMatchObject({ departmentId: dept.id, title: 'Trợ lý' });
      // the tool layer turns a 404 into a plain 400 the model can read
      expect(
        await toolError('create_agent', run.id, { name: 'Lạc', departmentId: foreignDept.id }, 400),
      ).toBe('Department not found');
      await toolError('create_agent', run.id, { name: 'Dài', title: 'x'.repeat(81) }, 400);

      // read tools show department name and title
      const agents = (await tool('list_agents', run.id)).result as Array<{
        id: string;
        department: string | null;
        title: string | null;
      }>;
      expect(agents.find((a) => a.id === created.id)).toMatchObject({
        department: 'Kinh doanh',
        title: 'Trợ lý',
      });
      await call('put', `/members/${member.memberId}/department`, { departmentId: dept.id });
      await call('put', `/members/${member.memberId}/title`, { title: 'Nhân viên' });
      const members = (await tool('list_members', run.id)).result as Array<{
        id: string;
        department: string | null;
        title: string | null;
      }>;
      expect(members.find((m) => m.id === member.memberId)).toMatchObject({
        department: 'Kinh doanh',
        title: 'Nhân viên',
      });

      // update: change, clear with null, blank title clears, foreign department -> 404
      const other = await call<{ id: string }>('post', '/departments', { name: 'Kỹ thuật' });
      const changed = (
        await tool('update_agent', run.id, {
          id: created.id,
          departmentId: other.id,
          title: 'Kỹ sư',
        })
      ).result as { departmentId: string | null; title: string | null };
      expect(changed).toMatchObject({ departmentId: other.id, title: 'Kỹ sư' });
      const cleared = (
        await tool('update_agent', run.id, { id: created.id, departmentId: null, title: null })
      ).result as { departmentId: string | null; title: string | null };
      expect(cleared).toMatchObject({ departmentId: null, title: null });
      await tool('update_agent', run.id, { id: created.id, title: 'Tạm' });
      const blank = (await tool('update_agent', run.id, { id: created.id, title: '\u0007' }))
        .result as { title: string | null };
      expect(blank.title).toBeNull();
      await toolError(
        'update_agent',
        run.id,
        { id: created.id, departmentId: foreignDept.id },
        400,
      );
      // omitted fields stay
      await tool('update_agent', run.id, { id: created.id, departmentId: dept.id, title: 'Giữ' });
      const kept = (await tool('update_agent', run.id, { id: created.id, persona: 'p' }))
        .result as { departmentId: string | null; title: string | null };
      expect(kept).toMatchObject({ departmentId: dept.id, title: 'Giữ' });
    });

    it('stops create_agent at the plan limit (403 billing.LIMIT_REACHED)', async () => {
      await setPlan(dataSource, me.workspaceId, 'free'); // 2 agents, one exists
      const ownerChat = await dmOf(agent, me);
      await sendChat(ownerChat, 'tạo agent', me);
      const run = (await gw<Claimed | null>('/claim', { maxChats: 3 }))!;
      await gw(`/assignments/${run.id}/accept`, { attempt: 1 });
      await tool('create_agent', run.id, { name: 'Second' });
      const message = await toolError('create_agent', run.id, { name: 'Third' }, 403);
      expect(message).toBe('The free plan allows up to 2 agents. Upgrade your plan to add more.');
      expect(
        await dataSource.getRepository(Agent).count({ where: { workspaceId: me.workspaceId } }),
      ).toBe(2);
    });

    it('lets a run without a requester only read', async () => {
      const { claimed } = await runningChat();
      await dataSource.query(`UPDATE assignments SET requested_by_member_id = NULL`);
      await tool('list_tasks', claimed.id);
      await toolError('create_task', claimed.id, { title: 'x' }, 403);
      await toolError('post_message', claimed.id, { markdown: 'x' }, 403);
      await toolError('create_agent', claimed.id, { name: 'x' }, 403);
    });

    it('only works while the assignment is running on this computer', async () => {
      const chatId = await dmOf(agent);
      await sendChat(chatId, 'hello');
      const claimed = (await gw<Claimed | null>('/claim', { maxChats: 3 }))!;
      expect(await toolError('list_agents', claimed.id, {}, 409)).toBe(
        'This assignment is not running',
      );
      await gw(`/assignments/${claimed.id}/accept`, { attempt: 1 });
      await tool('list_agents', claimed.id);
      await toolError('list_agents', 'not-a-uuid', {}, 404);
      await gwError('/tools/list_agents', {}, 404);
      await gw(`/assignments/${claimed.id}/result`, {
        attempt: 1,
        status: 'completed',
        text: 'ok',
      });
      expect(await toolError('list_agents', claimed.id, {}, 409)).toBe(
        'This assignment is not running',
      );
    });
  });

  // ---------- revoke ----------
  describe('revoking a computer', () => {
    it('drops the key, goes offline and cancels the open work', async () => {
      const taskId = (
        await call<Task>('post', '/tasks', { title: 'Việc', assigneeId: agent.id, status: 'doing' })
      ).id;
      await settle();
      const claimed = (await gw<Claimed | null>('/claim', { maxChats: 0 }))!;
      await gw(`/assignments/${claimed.id}/accept`, { attempt: 1 });
      const chatId = await dmOf(agent);
      await sendChat(chatId, 'pending chat');

      await call('delete', `/computers/${paired.computerId}`, undefined, member, 403);
      await call('delete', `/computers/${paired.computerId}`);
      await settle();

      await gwError('/heartbeat', {}, 401);
      await gwError(`/assignments/${claimed.id}/heartbeat`, { attempt: 1 }, 401);
      const computer = await dataSource.getRepository(Computer).findOneOrFail({
        where: { id: paired.computerId },
        select: { id: true, status: true, apiKeyHash: true },
      });
      expect(computer).toMatchObject({ status: 'offline', apiKeyHash: null });
      expect(
        await dataSource.getRepository(Assignment).count({ where: { status: 'cancelled' } }),
      ).toBe(2);
      expect(await taskOf(taskId)).toMatchObject({ status: 'todo', activeRun: null });
      const reply = await lastReply(chatId);
      expect(reply).toMatchObject({ status: 'failed', assignment: { status: 'cancelled' } });
      // still listed, but without any key material
      const listed = await call<Array<{ id: string; status: string }>>('get', '/computers');
      expect(listed.find((c) => c.id === paired.computerId)).toMatchObject({
        status: 'offline',
        revokedAt: expect.any(String),
      });
    });

    it('answers 404 for unknown or foreign computers and removes a simulated one', async () => {
      await call(
        'delete',
        `/computers/${'0'.repeat(8)}-0000-4000-8000-000000000000`,
        undefined,
        me,
        404,
      );
      await call('delete', '/computers/not-a-uuid', undefined, me, 404);
      const stranger = await registerAndLogin(app);
      await call('delete', `/computers/${paired.computerId}`, undefined, stranger, 404);
      const sim = await createComputer(dataSource, me.workspaceId, { simulated: true });
      await call('delete', `/computers/${sim.id}`, undefined, me, 200);
    });
  });

  describe('hardening', () => {
    it('keeps a second reply of the same agent and chat offered until the first ends', async () => {
      const chatId = await dmOf(agent);
      await sendChat(chatId, 'một');
      await sendChat(chatId, 'hai');
      const first = (await gw<Claimed | null>('/claim', { maxChats: 3 }))!;
      expect(first.prompt).toBe('một');
      expect(await gw('/claim', { maxChats: 3 })).toBeNull();
      await gw(`/assignments/${first.id}/accept`, { attempt: 1 });
      expect(await gw('/claim', { maxChats: 3 })).toBeNull();

      await gw(`/assignments/${first.id}/result`, {
        attempt: 1,
        status: 'completed',
        text: 'ok',
        sessionId: first.session.id,
      });
      const second = (await gw<Claimed | null>('/claim', { maxChats: 3 }))!;
      expect(second.prompt).toBe('hai');
      expect(second.session).toEqual({ id: first.session.id, resume: true });
    });

    it('keeps only the latest 200 tool calls of an assignment', async () => {
      const { claimed } = await runningChat();
      const events = Array.from({ length: 250 }, (_, i) => ({
        kind: 'tool',
        call: { id: `t${i}`, name: 'Read', input: '{}', output: 'x', status: 'ok' },
      }));
      await gw(`/assignments/${claimed.id}/progress`, { attempt: 1, events });
      const row = await dataSource.getRepository(Assignment).findOneByOrFail({ id: claimed.id });
      expect(row.toolLog).toHaveLength(200);
      expect(row.toolLog[0].id).toBe('t50');
      expect(row.toolLog.at(-1)!.id).toBe('t249');
      expect(row.toolCalls).toBe(250);
    });

    it('stores a placeholder for an empty completed reply and a session only when completed', async () => {
      const chatId = await dmOf(agent);
      await sendChat(chatId, 'im lặng đi');
      const claimed = (await gw<Claimed | null>('/claim', { maxChats: 3 }))!;
      await gw(`/assignments/${claimed.id}/accept`, { attempt: 1 });
      await gw(`/assignments/${claimed.id}/result`, {
        attempt: 1,
        status: 'completed',
        text: '  ',
      });
      expect((await lastReply(chatId)).markdown).toBe('(không có nội dung)');

      await sendChat(chatId, 'lỗi đi');
      const next = (await gw<Claimed | null>('/claim', { maxChats: 3 }))!;
      await gw(`/assignments/${next.id}/accept`, { attempt: 1 });
      await gw(`/assignments/${next.id}/result`, {
        attempt: 1,
        status: 'failed',
        error: 'boom',
        sessionId: next.session.id,
      });
      const saved = await dataSource.query(`SELECT 1 FROM agent_sessions`);
      expect(saved).toHaveLength(0);
    });

    it('accepts only relative workdir names from tools and stores them under the agents root', async () => {
      const ownerChat = await dmOf(agent, me);
      await sendChat(ownerChat, 'tạo agent', me);
      const claimed = (await gw<Claimed | null>('/claim', { maxChats: 3 }))!;
      await gw(`/assignments/${claimed.id}/accept`, { attempt: 1 });
      for (const workdir of ['/etc', '~/x', '../x', 'a/../../b', 'C:\\x', '..']) {
        await toolError('create_agent', claimed.id, { name: 'Bad', workdir }, 400);
      }
      const created = (
        await tool('create_agent', claimed.id, { name: 'Good', workdir: 'team/good' })
      ).result as { workdir: string };
      expect(created.workdir).toBe('~/.agent/agents/team/good');
      const plain = (await tool('create_agent', claimed.id, { name: 'Same Name' })).result as {
        id: string;
        workdir: string;
      };
      expect(plain.workdir).toBe(`~/.agent/agents/same-name-${plain.id.slice(0, 6)}`);
      await toolError('update_agent', claimed.id, { id: agent.id, workdir: '/tmp/x' }, 400);
    });

    it('limits write tool calls per assignment', async () => {
      const { claimed } = await runningChat();
      const task = await call<Task>('post', '/tasks', { title: 'Việc' });
      for (let i = 0; i < 20; i++) {
        await tool('comment_task', claimed.id, { id: task.id, markdown: `c${i}` });
      }
      const message = await toolError(
        'comment_task',
        claimed.id,
        { id: task.id, markdown: 'quá' },
        409,
      );
      expect(message).toContain('20');
      // reads are not counted
      await tool('list_tasks', claimed.id);
    });

    it('creates the tasks a task run hands to an agent in backlog instead of starting another run', async () => {
      const task = await call<Task>('post', '/tasks', {
        title: 'Cha',
        assigneeId: agent.id,
        status: 'doing',
      });
      await settle();
      const claimed = (await gw<Claimed | null>('/claim', { maxChats: 0 }))!;
      await gw(`/assignments/${claimed.id}/accept`, { attempt: 1 });
      expect(claimed.prompt).toContain(task.id);
      const child = (
        await tool('create_task', claimed.id, {
          title: 'Con',
          assigneeId: agent.id,
          status: 'doing',
        })
      ).result as { id: string; status: string };
      expect(child.status).toBe('backlog');
    });

    it('never gives a task run admin tools, whoever started it', async () => {
      const fromAdmin = await call<Task>('post', '/tasks', {
        title: 'Việc admin',
        status: 'todo',
      });
      await call('post', `/tasks/${fromAdmin.id}/comments`, { markdown: 'tạo agent Hằng' }, member);
      // the member hands the admin's task to an idle agent: the run acts for the member
      await call('patch', `/tasks/${fromAdmin.id}`, { assigneeId: agent.id }, member);
      await settle();
      const claimed = (await gw<Claimed | null>('/claim', { maxChats: 0 }))!;
      expect(claimed.kind).toBe('task');
      expect(claimed.context).not.toContain('create_agent, update_agent. There');
      expect(claimed.context).toContain('A task run cannot manage agents');
      await gw(`/assignments/${claimed.id}/accept`, { attempt: 1 });
      await toolError('create_agent', claimed.id, { name: 'Hằng' }, 403);
      await toolError('update_agent', claimed.id, { id: agent.id, persona: 'x' }, 403);
      expect(await dataSource.getRepository(Agent).count()).toBe(1);
      // an owner-started run is capped the same way, with a readable reason
      await dataSource.query(`UPDATE assignments SET requested_by_member_id = $1`, [me.memberId]);
      expect(await toolError('create_agent', claimed.id, { name: 'Hằng' }, 403)).toContain(
        'cannot use admin tools',
      );
      await tool('comment_task', claimed.id, { id: fromAdmin.id, markdown: 'ok' });
    });

    it('stops a task run from starting runs of other agents', async () => {
      const idle = await createAgent(dataSource, me.workspaceId, paired.computerId, {
        name: 'Idle',
      });
      const parent = await call<Task>('post', '/tasks', {
        title: 'Cha',
        assigneeId: agent.id,
        status: 'doing',
      });
      await settle();
      const claimed = (await gw<Claimed | null>('/claim', { maxChats: 0 }))!;
      await gw(`/assignments/${claimed.id}/accept`, { attempt: 1 });
      const idleRuns = () =>
        dataSource.getRepository(Assignment).count({ where: { agentId: idle.id } });

      const child = (
        await tool('create_task', claimed.id, { title: 'Con', assigneeId: idle.id, status: 'todo' })
      ).result as { id: string; status: string; running: boolean };
      expect(child).toMatchObject({ status: 'backlog', running: false });
      const other = (await tool('create_task', claimed.id, { title: 'Khác' })).result as {
        id: string;
      };

      expect(
        await toolError('update_task', claimed.id, { id: other.id, assigneeId: idle.id }, 403),
      ).toContain('cannot assign work to agents');
      await toolError('move_task', claimed.id, { id: child.id, status: 'todo' }, 403);
      await toolError('move_task', claimed.id, { id: child.id, status: 'doing' }, 403);
      await tool('move_task', claimed.id, { id: child.id, status: 'backlog' });
      // review stays a human decision
      expect(
        await toolError('move_task', claimed.id, { id: other.id, status: 'done' }, 403),
      ).toContain('cannot mark a task done');
      expect(
        await toolError('update_task', claimed.id, { id: other.id, requiresReview: false }, 403),
      ).toContain('requires review');
      // people can still be assigned, and agents unassigned
      await tool('update_task', claimed.id, { id: other.id, assigneeId: member.memberId });
      await tool('update_task', claimed.id, { id: other.id, assigneeId: null });
      await settle();
      expect(await idleRuns()).toBe(0);
      expect((await taskOf(parent.id)).status).toBe('doing');
    });

    it('keeps the requester role for chat runs (still can assign agents)', async () => {
      const idle = await createAgent(dataSource, me.workspaceId, paired.computerId, {
        name: 'Idle',
      });
      const chatId = await dmOf(agent, me);
      await sendChat(chatId, 'giao việc', me);
      const claimed = (await gw<Claimed | null>('/claim', { maxChats: 3 }))!;
      await gw(`/assignments/${claimed.id}/accept`, { attempt: 1 });
      const created = (
        await tool('create_task', claimed.id, {
          title: 'Giao',
          assigneeId: idle.id,
          status: 'doing',
        })
      ).result as { status: string };
      expect(created.status).toBe('doing');
    });

    it('stores a long result cut with a note and accepts large bodies', async () => {
      const { claimed } = await runningChat();
      const big = 'x'.repeat(300_000);
      await gw(`/assignments/${claimed.id}/progress`, {
        attempt: 1,
        events: [{ kind: 'text', delta: big }],
      });
      await gw(`/assignments/${claimed.id}/result`, {
        attempt: 1,
        status: 'completed',
        text: 'y'.repeat(500_000),
        costUsd: 0.0123,
        numTurns: 3,
      });
      const row = await dataSource.getRepository(Assignment).findOneByOrFail({ id: claimed.id });
      expect(row).toMatchObject({ status: 'completed', costUsd: 0.0123, numTurns: 3 });
      const placeholder = await dataSource
        .getRepository(ChatMessage)
        .findOneByOrFail({ id: row.sourceId });
      // A DM reply stays on the DM main timeline: its chat id is the room id.
      const reply = await lastReply(placeholder.parentId ?? placeholder.roomId);
      expect(reply.markdown.length).toBeLessThan(100_200);
      expect(reply.markdown).toContain('đã cắt bớt');
      expect(reply.assignment).toMatchObject({ costUsd: 0.0123 });
    });

    it('exposes the cost of a finished task run', async () => {
      const id = (
        await call<Task>('post', '/tasks', { title: 'Việc', assigneeId: agent.id, status: 'doing' })
      ).id;
      await settle();
      const claimed = (await gw<Claimed | null>('/claim', { maxChats: 0 }))!;
      await gw(`/assignments/${claimed.id}/accept`, { attempt: 1 });
      await gw(`/assignments/${claimed.id}/result`, {
        attempt: 1,
        status: 'completed',
        text: 'xong',
        costUsd: 0.5,
      });
      await settle();
      expect((await taskOf(id)).runs[0]).toMatchObject({ costUsd: 0.5 });
      expect(await call<Task>('get', `/tasks/${id}`)).toMatchObject({ id });
      await call('get', '/tasks/AG-9999', undefined, me, 404);
    });

    it('caps the active pairing codes per workspace at 5', async () => {
      const codes: string[] = [];
      for (let i = 0; i < 7; i++) codes.push(await pairingCode());
      const active = await dataSource.query(
        `SELECT count(*)::int AS n FROM pairing_codes WHERE used_at IS NULL AND workspace_id = $1`,
        [me.workspaceId],
      );
      expect(active[0].n).toBe(5);
      const body = { name: 'x', os: 'macOS', cliVersion: '0.1.0' };
      await http()
        .post(api('/gateway/pair'))
        .send({ ...body, code: codes[0] })
        .expect(401);
      await http()
        .post(api('/gateway/pair'))
        .send({ ...body, code: codes[6] })
        .expect(200);
    });
  });
  // ---------- room timelines and threads ----------
  describe('chat runs on room timelines', () => {
    const channel = (name: string) =>
      call<{ id: string }>('post', '/rooms', { name, agentIds: [agent.id] }, member);
    const roomPost = (roomId: string, body: object, client = member) =>
      call<Message>('post', `/rooms/${roomId}/messages`, body, client);
    const claimAccept = async () => {
      const claimed = (await gw<Claimed | null>('/claim', { maxChats: 3 }))!;
      await gw(`/assignments/${claimed.id}/accept`, { attempt: claimed.attempt });
      return claimed;
    };

    it('hands a channel mention over as a thread reply: wire fields, brief and session key', async () => {
      const room = await channel('ops');
      await roomPost(room.id, { markdown: 'main timeline noise' });
      const root = await roomPost(room.id, { markdown: 'Deploy plan', threadTitle: 'Deploy' });
      const trigger = await roomPost(room.id, { markdown: '@Claude go ahead', parentId: root.id });
      const claimed = await claimAccept();
      // installed daemons ignore the additive fields
      expect(claimed).toMatchObject({ kind: 'chat', roomId: room.id, parentId: root.id });
      expect(claimed.prompt).toBe('@Claude go ahead');
      expect(claimed.context).toContain(`Conversation: # ops › Deploy (chat ${root.id})`);
      expect(claimed.context).toContain(`Room id: ${room.id}; thread root message id: ${root.id}`);
      // the thread's messages are the history (the root too), not the room's main timeline
      expect(claimed.context).toContain('**Extra member**: Deploy plan');
      expect(claimed.context).not.toContain('main timeline noise');
      const row = await dataSource.getRepository(Assignment).findOneByOrFail({ id: claimed.id });
      expect(row.sessionKey).toBe(root.id); // the old thread id keeps its Claude session
      expect(trigger.parentId).toBe(root.id);
    });

    it('post_message defaults to the thread of the run, or goes to an explicit roomId/parentId', async () => {
      const room = await channel('ops2');
      const trigger = await roomPost(room.id, { markdown: '@Claude hi' });
      const claimed = await claimAccept();
      // a main-timeline trigger became the root of the thread the agent answers in
      expect(claimed).toMatchObject({ roomId: room.id, parentId: trigger.id });
      const id = claimed.id;
      const first = (await tool('post_message', id, { markdown: 'default place' }))
        .result as Record<string, unknown>;
      expect(first).toMatchObject({ chatId: trigger.id, roomId: room.id, parentId: trigger.id });
      // legacy address: the thread root id as chatId
      const legacy = (await tool('post_message', id, { chatId: trigger.id, markdown: 'legacy' }))
        .result as Record<string, unknown>;
      expect(legacy).toMatchObject({ parentId: trigger.id });
      // new address: the room alone is its main timeline
      const main = (await tool('post_message', id, { roomId: room.id, markdown: 'main' }))
        .result as { id: string; parentId: string | null; chatId: string };
      expect(main.parentId).toBeNull();
      expect(main.chatId).toBe(main.id);
      // a reply id attaches to its root
      const nested = (
        await tool('post_message', id, {
          roomId: room.id,
          parentId: first.id as string,
          markdown: 'nested',
        })
      ).result as { parentId: string };
      expect(nested.parentId).toBe(trigger.id);
      const thread = await call<{ replies: Message[] }>(
        'get',
        `/rooms/${room.id}/messages/${trigger.id}/thread`,
        undefined,
        member,
      );
      expect(thread.replies.map((m) => m.markdown)).toEqual([
        '', // the run's own (still streaming) reply
        'default place',
        'legacy',
        'nested',
      ]);
      expect(thread.replies.filter((m) => m.author.kind === 'agent')).toHaveLength(4);
      await toolError('post_message', id, { parentId: trigger.id, markdown: 'x' }, 400);
      await toolError('post_message', id, { roomId: NIL_ROOM, markdown: 'x' }, 400);
      const unknownParent = { roomId: room.id, parentId: NIL_ROOM, markdown: 'x' };
      await toolError('post_message', id, unknownParent, 400);
    });

    it('answers a DM main-timeline message in the DM, with the DM room as chat id', async () => {
      const { chatId, claimed } = await runningChat('xin chào');
      expect(claimed).toMatchObject({ roomId: chatId, parentId: null });
      expect(claimed.context).toContain(`Room id: ${chatId}`);
      expect(claimed.context).not.toContain('thread root message id');
      const posted = (await tool('post_message', claimed.id, { markdown: 'trong DM' })).result as {
        chatId: string;
        parentId: string | null;
      };
      expect(posted).toMatchObject({ chatId, parentId: null });
      const row = await dataSource.getRepository(Assignment).findOneByOrFail({ id: claimed.id });
      expect(row.sessionKey).toBe(chatId);
    });
  });
});
