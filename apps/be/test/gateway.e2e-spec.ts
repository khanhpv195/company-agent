import { ConflictException, INestApplication, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { ClockService } from '../src/common/clock';
import { LEASE_MS } from '../src/contacts';
import { AgentGatewayService } from '../src/modules/gateway/agent-gateway.service';
import {
  Assignment,
  AssignmentSourceKind,
} from '../src/modules/gateway/entities/assignment.entity';
import {
  ASSIGNMENT_ENDED_EVENT,
  ASSIGNMENT_PROGRESS_EVENT,
  REALTIME_EVENT,
  RealtimeEnvelope,
} from '../src/modules/events';
import { ComputersService } from '../src/modules/computers/computers.service';
import { Computer } from '../src/modules/computers/entities/computer.entity';
import {
  createAgent,
  createComputer,
  createTestApp,
  LoggedInClient,
  registerAndLogin,
  TestClock,
  truncateAll,
} from './utils';
import { Agent } from '../src/modules/agents/entities/agent.entity';
import type { AuthContext } from '../src/common/types';
import { ChatService } from '../src/modules/chat/chat.service';

describe('Agent gateway (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let gateway: AgentGatewayService;
  let computers: ComputersService;
  let emitter: EventEmitter2;
  let clock: TestClock;
  let me: LoggedInClient;
  let computer: Computer;
  let agent: Agent;
  let realtime: RealtimeEnvelope[];
  let ended: Record<string, unknown>[];
  let progressed: Record<string, unknown>[];

  beforeAll(async () => {
    clock = new TestClock();
    ({ app, dataSource } = await createTestApp((builder) =>
      builder.overrideProvider(ClockService).useValue(clock),
    ));
    gateway = app.get(AgentGatewayService);
    computers = app.get(ComputersService);
    emitter = app.get(EventEmitter2);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAll(dataSource);
    me = await registerAndLogin(app);
    computer = await createComputer(dataSource, me.workspaceId);
    agent = await createAgent(dataSource, me.workspaceId, computer.id);

    realtime = [];
    ended = [];
    progressed = [];
    emitter.removeAllListeners(REALTIME_EVENT);
    emitter.removeAllListeners(ASSIGNMENT_ENDED_EVENT);
    emitter.removeAllListeners(ASSIGNMENT_PROGRESS_EVENT);
    emitter.on(REALTIME_EVENT, (e: RealtimeEnvelope) => realtime.push(e));
    emitter.on(ASSIGNMENT_ENDED_EVENT, (e: Record<string, unknown>) => ended.push(e));
    emitter.on(ASSIGNMENT_PROGRESS_EVENT, (e: Record<string, unknown>) => progressed.push(e));
  });

  const offered = async (
    sourceKind: AssignmentSourceKind = 'chat',
    sourceId = `src-${Math.random()}`,
    forAgent: Agent = agent,
  ): Promise<Assignment> => {
    const created = await gateway.create({
      workspaceId: me.workspaceId,
      agentId: forAgent.id,
      sourceKind,
      sourceId,
    });
    return gateway.offer(created.id);
  };

  const running = async (kind: AssignmentSourceKind = 'chat'): Promise<Assignment> => {
    const row = await offered(kind);
    const claimed = await gateway.claim(computer.id);
    expect(claimed?.id).toBe(row.id);
    return gateway.accept(row.id, claimed!.attempt);
  };

  const rejectsTransition = (promise: Promise<unknown>) =>
    expect(promise).rejects.toMatchObject({
      constructor: ConflictException,
      response: { message: 'gateway.INVALID_TRANSITION' },
    });

  describe('lifecycle', () => {
    it('walks pending -> offered -> claimed -> running -> completed', async () => {
      const created = await gateway.create({
        workspaceId: me.workspaceId,
        agentId: agent.id,
        sourceKind: 'task',
        sourceId: 'AG-1',
        activation: 'mention',
      });
      expect(created).toMatchObject({
        status: 'pending',
        computerId: computer.id,
        attempt: 0,
        activation: 'mention',
      });
      await rejectsTransition(gateway.accept(created.id, 0));

      expect((await gateway.offer(created.id)).status).toBe('offered');
      await rejectsTransition(gateway.offer(created.id));

      const before = clock.now().getTime();
      const claimed = await gateway.claim(computer.id);
      expect(claimed).toMatchObject({ id: created.id, status: 'claimed', attempt: 1 });
      expect(claimed!.leaseExpiresAt!.getTime()).toBeGreaterThanOrEqual(before + LEASE_MS - 5);
      expect(await gateway.claim(computer.id)).toBeNull();

      const accepted = await gateway.accept(created.id, 1);
      expect(accepted.status).toBe('running');
      expect(accepted.startedAt).toBeInstanceOf(Date);
      await rejectsTransition(gateway.accept(created.id, 1));

      clock.advance(10_000);
      const renewed = await gateway.heartbeat(created.id, 1);
      expect(renewed.leaseExpiresAt!.getTime()).toBeGreaterThan(accepted.leaseExpiresAt!.getTime());

      const progress = await gateway.progress(created.id, 1, [
        { kind: 'tool', payload: { name: 'Bash' } },
        { kind: 'text' },
        { kind: 'tool' },
        { kind: 'step' },
      ]);
      expect(progress.toolCalls).toBe(2);
      expect(progressed).toHaveLength(1);

      const done = await gateway.result(created.id, 1, { status: 'completed' });
      expect(done).toMatchObject({ status: 'completed', error: null, leaseExpiresAt: null });
      expect(done.endedAt).toBeInstanceOf(Date);
      expect(ended).toEqual([
        {
          workspaceId: me.workspaceId,
          assignmentId: created.id,
          sourceKind: 'task',
          sourceId: 'AG-1',
          agentId: agent.id,
          status: 'completed',
        },
      ]);
      await rejectsTransition(gateway.progress(created.id, 1, []));
      await rejectsTransition(gateway.heartbeat(created.id, 1));
      await rejectsTransition(gateway.cancel(created.id));
    });

    it('unknown assignment ids are 404', async () => {
      await expect(gateway.offer('00000000-0000-4000-8000-000000000000')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('create rejects an agent from another workspace', async () => {
      const other = await registerAndLogin(app);
      await expect(
        gateway.create({
          workspaceId: other.workspaceId,
          agentId: agent.id,
          sourceKind: 'chat',
          sourceId: 'x',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('attempts', () => {
    it('rejects a wrong attempt on every daemon call', async () => {
      const row = await running();
      await rejectsTransition(gateway.accept(row.id, 2));
      await rejectsTransition(gateway.heartbeat(row.id, 2));
      await rejectsTransition(gateway.progress(row.id, 2, []));
      await rejectsTransition(gateway.result(row.id, 2, { status: 'completed' }));
      await rejectsTransition(gateway.result(row.id, 0, { status: 'failed' }));
    });

    it('result is idempotent for the same attempt and status', async () => {
      const row = await running();
      const first = await gateway.result(row.id, 1, { status: 'failed', error: 'boom' });
      expect(first).toMatchObject({ status: 'failed', error: 'boom' });
      realtime.length = 0;

      const again = await gateway.result(row.id, 1, { status: 'failed', error: 'other' });
      expect(again.error).toBe('boom');
      expect(again.endedAt!.getTime()).toBe(first.endedAt!.getTime());
      expect(ended).toHaveLength(1);
      expect(realtime).toEqual([]);

      await rejectsTransition(gateway.result(row.id, 1, { status: 'completed' }));
      await rejectsTransition(gateway.result(row.id, 2, { status: 'failed' }));
    });

    it('a result may arrive straight from claimed', async () => {
      await offered();
      const claimed = await gateway.claim(computer.id);
      const done = await gateway.result(claimed!.id, 1, { status: 'failed', error: 'no start' });
      expect(done.status).toBe('failed');
    });
  });

  describe('claim', () => {
    it('lets exactly one of two parallel claims win a single offered assignment', async () => {
      await offered();
      const results = await Promise.all([gateway.claim(computer.id), gateway.claim(computer.id)]);
      expect(results.filter(Boolean)).toHaveLength(1);
      expect(
        await dataSource.getRepository(Assignment).count({ where: { status: 'claimed' } }),
      ).toBe(1);
    });

    it('lets exactly one of two parallel offers win two task runs of one agent', async () => {
      const rows = await Promise.all(
        ['AG-1', 'AG-2'].map((sourceId) =>
          gateway.create({
            workspaceId: me.workspaceId,
            agentId: agent.id,
            sourceKind: 'task',
            sourceId,
          }),
        ),
      );
      const results = await Promise.allSettled(rows.map((row) => gateway.offer(row.id)));
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      const failed = results.find((result) => result.status === 'rejected');
      expect(failed).toMatchObject({
        reason: { constructor: ConflictException, response: { message: 'gateway.AGENT_BUSY' } },
      });
      expect(
        await dataSource.getRepository(Assignment).count({ where: { status: 'offered' } }),
      ).toBe(1);
    });

    it('claims oldest first, per agent filter, and ignores other computers', async () => {
      const second = await createAgent(dataSource, me.workspaceId, computer.id, { name: 'Two' });
      const elsewhere = await createComputer(dataSource, me.workspaceId, { name: 'other' });
      const third = await createAgent(dataSource, me.workspaceId, elsewhere.id, { name: 'Far' });
      const first = await offered('chat', 'one');
      const forSecond = await offered('chat', 'two', second);
      await offered('chat', 'far', third);

      expect((await gateway.claim(computer.id, second.id))?.id).toBe(forSecond.id);
      expect((await gateway.claim(computer.id))?.id).toBe(first.id);
      expect(await gateway.claim(computer.id)).toBeNull();
      expect((await gateway.claim(elsewhere.id))?.sourceId).toBe('far');
    });

    it('never claims pending assignments', async () => {
      await gateway.create({
        workspaceId: me.workspaceId,
        agentId: agent.id,
        sourceKind: 'chat',
        sourceId: 'p',
      });
      expect(await gateway.claim(computer.id)).toBeNull();
    });

    it('refuses a second task run per agent at offer; chat replies are not limited', async () => {
      const first = await offered('task', 'AG-1');
      expect((await gateway.claim(computer.id))?.id).toBe(first.id);
      await gateway.accept(first.id, 1);

      // The partial unique index is the hard guarantee underneath the engine's own check.
      const second = await gateway.create({
        workspaceId: me.workspaceId,
        agentId: agent.id,
        sourceKind: 'task',
        sourceId: 'AG-2',
      });
      await expect(gateway.offer(second.id)).rejects.toMatchObject({
        constructor: ConflictException,
        response: { message: 'gateway.AGENT_BUSY' },
      });
      expect(
        (await dataSource.getRepository(Assignment).findOneByOrFail({ id: second.id })).status,
      ).toBe('pending');
      expect(await gateway.claim(computer.id)).toBeNull();

      const chat = await offered('chat', 'c1');
      expect((await gateway.claim(computer.id))?.id).toBe(chat.id);

      // Once the task run ends, the next one can be offered and claimed.
      await gateway.result(first.id, 1, { status: 'completed' });
      await gateway.offer(second.id);
      expect((await gateway.claim(computer.id))?.id).toBe(second.id);
    });

    it('filters a claim by source kind', async () => {
      await offered('chat', 'c1');
      const task = await offered('task', 'AG-1');
      expect(await gateway.claim(computer.id, undefined, 'task').then((r) => r?.id)).toBe(task.id);
      expect(await gateway.claim(computer.id, undefined, 'task')).toBeNull();
    });

    it('an offered task run occupies its agent, other agents are unaffected', async () => {
      const other = await createAgent(dataSource, me.workspaceId, computer.id, { name: 'Two' });
      await running('task');
      const free = await offered('task', 'AG-3', other);
      expect((await gateway.claim(computer.id))?.id).toBe(free.id);
    });
  });

  describe('cancel and leases', () => {
    it('cancels pending, offered and running assignments', async () => {
      const pending = await gateway.create({
        workspaceId: me.workspaceId,
        agentId: agent.id,
        sourceKind: 'chat',
        sourceId: 'p',
      });
      expect((await gateway.cancel(pending.id)).status).toBe('cancelled');
      const queued = await offered();
      expect((await gateway.cancel(queued.id)).status).toBe('cancelled');
      const live = await running();
      realtime.length = 0;
      const cancelled = await gateway.cancel(live.id);
      expect(cancelled).toMatchObject({ status: 'cancelled', leaseExpiresAt: null });
      expect(ended.map((e) => e.status)).toEqual(['cancelled', 'cancelled', 'cancelled']);
      expect(realtime.map((e) => e.event.type)).toContain('agents.changed');
      await rejectsTransition(gateway.cancel(live.id));
    });

    it('expires claimed and running assignments past their lease only', async () => {
      const live = await running('chat');
      await offered('task', 'AG-9');
      const claimedOnly = await gateway.claim(computer.id);
      expect(claimedOnly?.status).toBe('claimed');
      const queued = await offered('chat', 'q');

      expect(await gateway.reconcileLeases(clock.now())).toBe(0);
      const future = new Date(clock.now().getTime() + LEASE_MS + 1_000);
      expect(await gateway.reconcileLeases(future)).toBe(2);

      const repo = dataSource.getRepository(Assignment);
      expect((await repo.findOneByOrFail({ id: live.id })).status).toBe('expired');
      expect((await repo.findOneByOrFail({ id: claimedOnly!.id })).status).toBe('expired');
      expect((await repo.findOneByOrFail({ id: queued.id })).status).toBe('offered');
      expect(ended.map((e) => e.status)).toEqual(['expired', 'expired']);
      expect(await gateway.reconcileLeases(future)).toBe(0);
      await rejectsTransition(gateway.result(live.id, 1, { status: 'completed' }));
    });

    it('a heartbeat keeps the lease alive past the original expiry', async () => {
      const row = await running();
      clock.advance(LEASE_MS - 5_000);
      await gateway.heartbeat(row.id, 1);
      const at = new Date(clock.now().getTime() + 10_000);
      expect(await gateway.reconcileLeases(at)).toBe(0);
    });
  });

  describe('realtime events', () => {
    it('publishes agents.changed on create, offer, claim and when the run ends', async () => {
      const row = await offered();
      // create + offer
      expect(realtime.map((e) => e.event.type)).toEqual(['agents.changed', 'agents.changed']);
      realtime.length = 0;
      await gateway.claim(computer.id);
      expect(realtime).toEqual([
        { workspaceId: me.workspaceId, event: { type: 'agents.changed' } },
      ]);
      await gateway.accept(row.id, 1);
      expect(realtime).toHaveLength(1);
      await gateway.result(row.id, 1, { status: 'completed' });
      expect(realtime).toHaveLength(2);
    });
  });

  describe('joining a caller transaction', () => {
    const task = (sourceId: string) => ({
      workspaceId: me.workspaceId,
      agentId: agent.id,
      sourceKind: 'task' as const,
      sourceId,
    });

    it('runs on the given manager and hands the effects to the caller', async () => {
      const effects: (() => void)[] = [];
      const row = await dataSource.transaction(async (manager) => {
        const tx = { manager, effects };
        const created = await gateway.create(task('AG-1'), tx);
        const offeredRow = await gateway.offer(created.id, tx);
        // Not visible outside, and nothing fired yet.
        expect(await dataSource.getRepository(Assignment).count()).toBe(0);
        expect(realtime).toHaveLength(0);
        const cancelled = await gateway.cancel(offeredRow.id, tx);
        expect(cancelled.status).toBe('cancelled');
        return cancelled;
      });
      expect(effects.length).toBeGreaterThan(0);
      expect(realtime).toHaveLength(0);
      expect(ended).toHaveLength(0);
      effects.forEach((effect) => effect());
      expect(ended.map((e) => e.assignmentId)).toEqual([row.id]);
      expect(realtime.every((e) => e.event.type === 'agents.changed')).toBe(true);
    });

    it('leaves nothing behind when the caller rolls back', async () => {
      const effects: (() => void)[] = [];
      await expect(
        dataSource.transaction(async (manager) => {
          const tx = { manager, effects };
          const created = await gateway.create(task('AG-1'), tx);
          await gateway.offer(created.id, tx);
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');
      expect(await dataSource.getRepository(Assignment).count()).toBe(0);
      expect(realtime).toHaveLength(0);
    });

    it('turns the one-task-run index violation inside the caller transaction into a 409', async () => {
      await running('task');
      await expect(
        dataSource.transaction(async (manager) => {
          const tx = { manager, effects: [] };
          const created = await gateway.create(task('AG-2'), tx);
          await gateway.offer(created.id, tx);
        }),
      ).rejects.toMatchObject({ response: { message: 'gateway.AGENT_BUSY' } });
    });
  });

  describe('computers', () => {
    it('heartbeat brings a computer online and reports the change', async () => {
      await dataSource.getRepository(Computer).update({ id: computer.id }, { status: 'offline' });
      await computers.heartbeat(computer.id);
      const row = await dataSource.getRepository(Computer).findOneByOrFail({ id: computer.id });
      expect(row.status).toBe('online');
      expect(realtime.map((e) => e.event.type)).toEqual(['computers.changed', 'agents.changed']);
      realtime.length = 0;
      await computers.heartbeat(computer.id);
      expect(realtime).toEqual([]);
      await expect(
        computers.heartbeat('00000000-0000-4000-8000-000000000000'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('markStale flips only silent online computers to offline', async () => {
      // The shared test clock may have been advanced by earlier tests.
      await dataSource
        .getRepository(Computer)
        .update({ id: computer.id }, { lastHeartbeatAt: clock.now() });
      const silent = await createComputer(dataSource, me.workspaceId, {
        name: 'silent',
        lastHeartbeatAt: new Date(clock.now().getTime() - 60_000),
      });
      const fresh = await createComputer(dataSource, me.workspaceId, {
        name: 'fresh',
        lastHeartbeatAt: new Date(clock.now().getTime() - 5_000),
      });
      const alreadyOff = await createComputer(dataSource, me.workspaceId, {
        name: 'off',
        status: 'offline',
        lastHeartbeatAt: new Date(clock.now().getTime() - 60_000),
      });

      expect(await computers.markStale(clock.now())).toBe(1);
      const status = async (id: string) =>
        (await dataSource.getRepository(Computer).findOneByOrFail({ id })).status;
      expect(await status(silent.id)).toBe('offline');
      expect(await status(fresh.id)).toBe('online');
      expect(await status(alreadyOff.id)).toBe('offline');
      expect(realtime.map((e) => e.event.type)).toEqual(['computers.changed', 'agents.changed']);
      expect(await computers.markStale(clock.now())).toBe(0);
    });

    it('issues an api key whose sha256 is stored, never the plaintext', async () => {
      const key = await computers.issueApiKey(computer.id);
      expect(key).toMatch(/^agk_[A-Za-z0-9_-]{43}$/);
      const [row] = await dataSource.query<{ api_key_hash: string }[]>(
        'SELECT api_key_hash FROM computers WHERE id = $1',
        [computer.id],
      );
      expect(row.api_key_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(row.api_key_hash).not.toContain(key);
      const second = await computers.issueApiKey(computer.id);
      expect(second).not.toBe(key);
    });
  });

  describe('chat assignments on offline computers', () => {
    const auth = (): AuthContext => ({
      memberId: me.memberId,
      workspaceId: me.workspaceId,
      role: 'member',
    });

    it('expires them with a readable error and fails the message (simulator off)', async () => {
      const off = await createComputer(dataSource, me.workspaceId, {
        name: 'build-box',
        status: 'offline',
        simulated: true,
      });
      const deployer = await createAgent(dataSource, me.workspaceId, off.id, { name: 'Deployer' });
      const chat = app.get(ChatService);
      // beforeEach removed every ASSIGNMENT_ENDED listener, ChatService's own included.
      emitter.on(
        ASSIGNMENT_ENDED_EVENT,
        (e: Parameters<ChatService['onAssignmentEnded']>[0]) => void chat.onAssignmentEnded(e),
      );
      const { chatId } = await chat.ensureDm(auth(), deployer.id);
      await chat.sendMessage(auth(), chatId, { markdown: 'deploy please' });

      const [pending] = await chat.listMessages(auth(), chatId).then((m) => m.slice(-1));
      expect(pending).toMatchObject({ status: 'streaming' });
      expect(pending.assignment).toMatchObject({ status: 'pending' });

      expect(await gateway.expireOfflineChatAssignments()).toBe(1);
      expect(await gateway.expireOfflineChatAssignments()).toBe(0);
      // onAssignmentEnded fails the message asynchronously
      await new Promise((resolve) => setTimeout(resolve, 100));
      const [reply] = await chat.listMessages(auth(), chatId).then((m) => m.slice(-1));
      expect(reply).toMatchObject({ status: 'failed' });
      expect(reply.assignment).toMatchObject({
        status: 'expired',
        error: 'build-box offline, không có máy nhận việc',
      });
    });

    it('leaves chat assignments of an online computer alone', async () => {
      const chat = app.get(ChatService);
      const { chatId } = await chat.ensureDm(auth(), agent.id);
      await chat.sendMessage(auth(), chatId, { markdown: 'hi' });
      expect(await gateway.expireOfflineChatAssignments()).toBe(0);
    });
  });
});
