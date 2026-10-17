import { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { ApiResponse, AttentionItem, DashboardSummary, Task } from '@repo/shared';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { ClockService } from '../src/common/clock';
import { CHAT_RUN_ENDED_EVENT, type ChatRunEndedPayload } from '../src/modules/chat/chat.constants';
import {
  COMPUTER_OFFLINE_EVENT,
  type ComputerStatusPayload,
} from '../src/modules/computers/computer-events';
import { ComputersService } from '../src/modules/computers/computers.service';
import { REALTIME_EVENT, RealtimeEnvelope } from '../src/modules/events';
import { AgentGatewayService } from '../src/modules/gateway/agent-gateway.service';
import { TaskEngineService } from '../src/modules/tasks/task-engine.service';
import { Random, TaskTimers } from '../src/modules/tasks/task-timers';
import {
  createAgent,
  createComputer,
  createTestApp,
  createWorld,
  LoggedInClient,
  registerAndLogin,
  TestClock,
  truncateAll,
  World,
} from './utils';

/** A clock that can be pinned to an instant (day-boundary tests), else real time. */
class SettableClock extends TestClock {
  fixed: Date | null = null;
  override now(): Date {
    return this.fixed ?? super.now();
  }
}

class ManualTimers extends TaskTimers {
  pending: (() => void)[] = [];
  override later(_ms: number, fn: () => void): void {
    this.pending.push(fn);
  }
}

class FixedRandom extends Random {
  value = 0.99;
  override next(): number {
    return this.value;
  }
}

describe('Dashboard (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let engine: TaskEngineService;
  let gateway: AgentGatewayService;
  let computers: ComputersService;
  let emitter: EventEmitter2;
  const clock = new SettableClock();
  const timers = new ManualTimers();
  const random = new FixedRandom();
  let me: LoggedInClient;
  let realtime: RealtimeEnvelope[];

  beforeAll(async () => {
    ({ app, dataSource } = await createTestApp((builder) =>
      builder
        .overrideProvider(ClockService)
        .useValue(clock)
        .overrideProvider(TaskTimers)
        .useValue(timers)
        .overrideProvider(Random)
        .useValue(random),
    ));
    engine = app.get(TaskEngineService);
    gateway = app.get(AgentGatewayService);
    computers = app.get(ComputersService);
    emitter = app.get(EventEmitter2);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await engine.settled();
    await truncateAll(dataSource);
    timers.pending = [];
    random.value = 0.99;
    clock.fixed = null;
    me = await registerAndLogin(app);
    realtime = [];
    emitter.removeAllListeners(REALTIME_EVENT);
    emitter.on(REALTIME_EVENT, (e: RealtimeEnvelope) => realtime.push(e));
  });

  // ---------- helpers ----------
  const call = async <T>(
    method: 'get' | 'post',
    path: string,
    expected = 200,
    client = me,
  ): Promise<T> => {
    const response = await request(app.getHttpServer())
      [method](`/api/v1${path}`)
      .set(client.bearer);
    expect(response.status).toBe(expected);
    return (response.body as ApiResponse<T>).data;
  };
  const summary = (client = me) => call<DashboardSummary>('get', '/dashboard', 200, client);
  const settle = () => engine.settled();
  const dashboardEvents = () => realtime.filter((e) => e.event.type === 'dashboard.changed').length;

  /** A finished chat assignment ended at `endedAt`, that took `seconds`. */
  const chatDone = (
    workspaceId: string,
    agentId: string,
    computerId: string,
    endedAt: string,
    status: 'completed' | 'failed' = 'completed',
    seconds = 4,
  ) => {
    const ended = new Date(endedAt);
    return dataSource.query(
      `INSERT INTO assignments (workspace_id, agent_id, computer_id, source_kind, source_id, status,
         attempt, started_at, ended_at, created_at, updated_at)
       VALUES ($1, $2, $3, 'chat', $4, $5, 1, $6, $7, $6, $7)`,
      [
        workspaceId,
        agentId,
        computerId,
        randomUUID(),
        status,
        new Date(ended.getTime() - seconds * 1000),
        ended,
      ],
    );
  };

  /** A finalized task run (needs its task row and an assignment). */
  const taskRunDone = async (
    workspaceId: string,
    agentId: string,
    computerId: string,
    taskId: string,
    endedAt: string,
    status: 'completed' | 'failed',
    durationSec: number,
  ) => {
    await dataSource.query(`INSERT INTO tasks (workspace_id, id, title) VALUES ($1, $2, 'T')`, [
      workspaceId,
      taskId,
    ]);
    const ended = new Date(endedAt);
    const [{ id }] = (await dataSource.query(
      `INSERT INTO assignments (workspace_id, agent_id, computer_id, source_kind, source_id, status,
         attempt, started_at, ended_at, created_at, updated_at)
       VALUES ($1, $2, $3, 'task', $4, $5, 1, $6, $7, $6, $7) RETURNING id`,
      [
        workspaceId,
        agentId,
        computerId,
        taskId,
        status,
        new Date(ended.getTime() - durationSec * 1000),
        ended,
      ],
    )) as { id: string }[];
    await dataSource.query(
      `INSERT INTO task_runs (workspace_id, task_id, assignment_id, n, step, steps, status,
         duration_sec, tool_calls, finalized_at)
       VALUES ($1, $2, $3, 1, 0, '[]', $4, $5, 0, $6)`,
      [workspaceId, taskId, id, status, durationSec, ended],
    );
  };

  describe('aggregates', () => {
    it('zero-fills 14 local days (oldest first) and cuts days in the workspace timezone', async () => {
      // 2026-03-10 17:30 UTC = 2026-03-11 00:30 in Asia/Ho_Chi_Minh.
      clock.fixed = new Date('2026-03-10T17:30:00Z');
      const pc = await createComputer(dataSource, me.workspaceId);
      const a = await createAgent(dataSource, me.workspaceId, pc.id, { name: 'A' });
      const w = me.workspaceId;
      await chatDone(w, a.id, pc.id, '2026-03-10T16:59:59Z'); // local 03-10 23:59:59
      await chatDone(w, a.id, pc.id, '2026-03-10T17:00:01Z'); // local 03-11 00:00:01
      await chatDone(w, a.id, pc.id, '2026-03-10T17:10:00Z', 'failed');
      await chatDone(w, a.id, pc.id, '2026-02-25T16:59:59Z'); // local 02-25 23:59:59: out
      await chatDone(w, a.id, pc.id, '2026-02-25T17:00:00Z'); // local 02-26 00:00:00: first day
      await chatDone(w, a.id, pc.id, '2026-03-10T17:40:00Z'); // after "now" -> local today, but future
      const data = await summary();

      expect(data.days).toHaveLength(14);
      expect(data.days[0]).toEqual({ date: '2026-02-26', completed: 1, failed: 0 });
      expect(data.days[12]).toEqual({ date: '2026-03-10', completed: 1, failed: 0 });
      expect(data.days[13].date).toBe('2026-03-11');
      expect(data.days.map((d) => d.date)).toEqual([...data.days.map((d) => d.date)].sort());
      const quiet = data.days.slice(1, 12);
      expect(quiet.every((d) => d.completed === 0 && d.failed === 0)).toBe(true);
      // The row 10 minutes after "now" is still the same local day, so it counts today.
      expect(data.days[13]).toMatchObject({ completed: 2, failed: 1 });
    });

    it('counts chat replies and task runs per agent and sums today minutes (at least 1 each)', async () => {
      clock.fixed = new Date('2026-03-10T17:30:00Z');
      const pc = await createComputer(dataSource, me.workspaceId);
      const a = await createAgent(dataSource, me.workspaceId, pc.id, { name: 'A' });
      const b = await createAgent(dataSource, me.workspaceId, pc.id, { name: 'B' });
      const idle = await createAgent(dataSource, me.workspaceId, pc.id, { name: 'Idle' });
      const w = me.workspaceId;
      // a: two chat replies today (1 min each), one task run of 150 s today (3 min),
      // one of 40 min yesterday. b: one reply today.
      await chatDone(w, a.id, pc.id, '2026-03-10T17:05:00Z');
      await chatDone(w, a.id, pc.id, '2026-03-10T17:06:00Z', 'failed');
      await taskRunDone(w, a.id, pc.id, 'AG-1', '2026-03-10T17:20:00Z', 'completed', 150);
      await taskRunDone(w, a.id, pc.id, 'AG-2', '2026-03-09T10:00:00Z', 'failed', 2400);
      await chatDone(w, b.id, pc.id, '2026-03-10T17:07:00Z');
      // Cancelled/expired work and unfinished chat do not count.
      await chatDone(w, b.id, pc.id, '2026-03-10T17:08:00Z', 'completed').then(() =>
        dataSource.query(
          `UPDATE assignments SET status = 'cancelled' WHERE agent_id = $1 AND ended_at = $2`,
          [b.id, new Date('2026-03-10T17:08:00Z')],
        ),
      );
      const data = await summary();
      expect(data.byAgent).toEqual([
        { agentId: a.id, count: 4 },
        { agentId: b.id, count: 1 },
      ]);
      expect(data.byAgent.some((x) => x.agentId === idle.id)).toBe(false);
      expect(data.minutesToday).toBe(1 + 1 + 3 + 1);
      expect(data.days[13]).toMatchObject({ completed: 3, failed: 1 });
      expect(data.days[11]).toMatchObject({ completed: 0, failed: 1 });
    });

    it('lists the latest 8 feed items newest first', async () => {
      const pc = await createComputer(dataSource, me.workspaceId);
      const agent = await createAgent(dataSource, me.workspaceId, pc.id);
      for (let i = 0; i < 10; i++) {
        await dataSource.query(
          `INSERT INTO feed_items (workspace_id, by, text, at) VALUES ($1, $2, $3, $4)`,
          [me.workspaceId, agent.id, `item ${i}`, new Date(Date.now() - (10 - i) * 60_000)],
        );
      }
      const { feed } = await summary();
      expect(feed.map((f) => f.text)).toEqual([9, 8, 7, 6, 5, 4, 3, 2].map((i) => `item ${i}`));
      expect(feed[0]).toMatchObject({ by: agent.id });
    });

    it('is scoped to the caller workspace', async () => {
      const pc = await createComputer(dataSource, me.workspaceId);
      const agent = await createAgent(dataSource, me.workspaceId, pc.id);
      await chatDone(me.workspaceId, agent.id, pc.id, new Date().toISOString());
      await dataSource.query(
        `INSERT INTO feed_items (workspace_id, by, text, at) VALUES ($1, $2, 'x', now())`,
        [me.workspaceId, agent.id],
      );
      const other = await registerAndLogin(app);
      const mine = await summary();
      const theirs = await summary(other);
      expect(mine.feed).toHaveLength(1);
      expect(theirs).toMatchObject({ byAgent: [], minutesToday: 0, attention: [], feed: [] });
      expect(theirs.days).toHaveLength(14);
    });
  });

  describe('writers', () => {
    let w: World;
    const finish = async (id: string) => {
      for (;;) {
        const claimed = await gateway.claim(w.c1.id, undefined, 'task');
        if (!claimed) break;
        await gateway.accept(claimed.id, claimed.attempt);
      }
      for (let guard = 0; guard < 50; guard++) {
        const task = (await call<Task[]>('get', '/tasks')).find((t) => t.id === id)!;
        if (!task.activeRun) return;
        await engine.advance(w.me.workspaceId, id);
        await settle();
      }
      throw new Error(`${id} did not finish`);
    };

    beforeEach(async () => {
      w = await createWorld(dataSource, me, clock.now().getTime());
    });

    it('feeds a finished run and counts it, with no attention item', async () => {
      const before = await summary();
      await finish('AG-31');
      await settle();
      const data = await summary();
      expect(data.feed[0]).toMatchObject({
        by: w.agents.a1.id,
        text: 'xong **Tóm tắt email sáng nay và gắn nhãn**',
      });
      expect(data.attention).toEqual([]);
      expect(data.days[13].completed).toBe(before.days[13].completed + 1);
      expect(data.minutesToday).toBe(before.minutesToday + 1);
      expect(dashboardEvents()).toBeGreaterThan(0);
    });

    it('opens one error item per failed task, feeds the failure, and resolves it on success', async () => {
      random.value = 0;
      const failedBefore = (await summary()).days[13].failed;
      await finish('AG-31');
      await settle();
      let data = await summary();
      expect(data.feed[0].text).toBe('thất bại ở **Tóm tắt email sáng nay và gắn nhãn**');
      expect(data.attention).toHaveLength(1);
      expect(data.attention[0]).toMatchObject({
        kind: 'error',
        title: 'Tóm tắt email sáng nay và gắn nhãn thất bại',
        meta: "khanhpv's Claude · AG-31",
        action: 'Chạy lại',
        taskId: 'AG-31',
        resolved: false,
      });
      expect(data.days[13].failed).toBe(failedBefore + 1);

      // Failing again while the item is open adds no second item (dedup).
      await call('post', '/tasks/AG-31/retry');
      await finish('AG-31');
      await settle();
      data = await summary();
      expect(data.attention).toHaveLength(1);
      expect(data.days[13].failed).toBe(failedBefore + 2);

      // A later success of the same task resolves its error item.
      random.value = 0.99;
      await call('post', '/tasks/AG-31/retry');
      await finish('AG-31');
      await settle();
      data = await summary();
      expect(data.attention).toEqual([]);
      expect(data.feed[0].text).toBe('xong **Tóm tắt email sáng nay và gắn nhãn**');
    });

    it('does not record a cancelled run', async () => {
      const before = await summary();
      await call('post', '/tasks/AG-31/stop');
      await settle();
      const data = await summary();
      expect(data.attention).toEqual([]);
      expect(data.feed).toEqual([]);
      expect(data.days[13]).toEqual(before.days[13]);
      expect(data.minutesToday).toBe(before.minutesToday);
    });

    it('feeds an approval by the approving member', async () => {
      await call('post', '/tasks/AG-29/approve');
      await settle();
      const { feed } = await summary();
      expect(feed[0].by).toBe(me.memberId);
      expect(feed[0].text).toMatch(/^duyệt \*\*.+\*\*$/);
    });

    it('feeds finished chat replies', async () => {
      const base = { workspaceId: me.workspaceId, agentId: w.agents.a2.id, durationSec: 4 };
      const ok: ChatRunEndedPayload = { ...base, ok: true, preview: 'Hello', dm: false };
      const bad: ChatRunEndedPayload = { ...base, ok: false, preview: 'Crawl giá', dm: false };
      emitter.emit(CHAT_RUN_ENDED_EVENT, ok);
      emitter.emit(CHAT_RUN_ENDED_EVENT, bad);
      await settle();
      const { feed } = await summary();
      expect(feed.map((f) => f.text).sort()).toEqual(
        ['thất bại khi trả lời **Crawl giá**', 'trả lời **Hello**'].sort(),
      );
      expect(feed.every((f) => f.by === w.agents.a2.id)).toBe(true);
    });

    it('opens an offline item when a computer goes stale, once, and resolves it when it returns', async () => {
      await dataSource.query(`UPDATE computers SET last_heartbeat_at = $2 WHERE id = $1`, [
        w.c1.id,
        new Date(Date.now() - 60_000),
      ]);
      expect(await computers.markStale(clock.now())).toBe(1);
      await settle();
      let data = await summary();
      expect(data.attention).toHaveLength(1);
      expect(data.attention[0]).toMatchObject({
        kind: 'offline',
        title: 'khanhpv-MacBook-Pro offline',
        meta: "khanhpv's Claude, Research Bot không nhận được việc mới",
        action: 'Hướng dẫn',
        taskId: null,
      });

      // The same event again (a second reconcile instance) adds nothing.
      const payload: ComputerStatusPayload = {
        workspaceId: me.workspaceId,
        computerId: w.c1.id,
        name: w.c1.name,
      };
      emitter.emit(COMPUTER_OFFLINE_EVENT, payload);
      await settle();
      expect((await summary()).attention).toHaveLength(1);

      await computers.heartbeat(w.c1.id);
      await settle();
      expect((await summary()).attention).toEqual([]);

      // A new outage opens a new item.
      await dataSource.query(`UPDATE computers SET last_heartbeat_at = $2 WHERE id = $1`, [
        w.c1.id,
        new Date(Date.now() - 60_000),
      ]);
      await computers.markStale(clock.now());
      await settle();
      data = await summary();
      expect(data.attention).toHaveLength(1);
    });

    describe('resolve', () => {
      const openItem = async (taskId: string | null, kind = 'error') => {
        const [{ id }] = (await dataSource.query(
          `INSERT INTO attention_items (workspace_id, kind, title, meta, action, task_id, dedup_key, created_at)
           VALUES ($1, $2, 't', 'm', 'a', $3, $4, now()) RETURNING id`,
          [me.workspaceId, kind, taskId, `${kind}:${taskId ?? ''}:${randomUUID()}`],
        )) as { id: string }[];
        return id;
      };

      it('retries the failed task through the engine and returns the resolved item', async () => {
        random.value = 0;
        await finish('AG-31');
        await settle();
        random.value = 0.99;
        const [item] = (await summary()).attention;
        const before = realtime.length;
        const resolved = await call<AttentionItem>(
          'post',
          `/dashboard/attention/${item.id}/resolve`,
        );
        expect(resolved).toMatchObject({ id: item.id, resolved: true, taskId: 'AG-31' });
        const task = (await call<Task[]>('get', '/tasks')).find((t) => t.id === 'AG-31')!;
        expect(task.error).toBeNull();
        expect(task.status).toBe('doing');
        expect(task.activeRun).not.toBeNull();
        expect((await summary()).attention).toEqual([]);
        expect(realtime.slice(before).map((e) => e.event.type)).toEqual(
          expect.arrayContaining(['dashboard.changed', 'tasks.changed']),
        );
      });

      it('queues the task when its agent is busy', async () => {
        await dataSource.query(
          `UPDATE tasks SET error = 'boom', status = 'todo' WHERE id = 'AG-25'`,
        );
        const id = await openItem('AG-25');
        await call<AttentionItem>('post', `/dashboard/attention/${id}/resolve`);
        const task = (await call<Task[]>('get', '/tasks')).find((t) => t.id === 'AG-25')!;
        expect(task.error).toBeNull();
        expect(task.status).toBe('todo');
        expect(task.activeRun).toBeNull();
      });

      it('keeps the task blocked when its computer is offline', async () => {
        await dataSource.query(
          `UPDATE tasks SET error = 'boom', blocked_reason = NULL WHERE id = 'AG-27'`,
        );
        const id = await openItem('AG-27');
        const resolved = await call<AttentionItem>('post', `/dashboard/attention/${id}/resolve`);
        expect(resolved.resolved).toBe(true);
        const task = (await call<Task[]>('get', '/tasks')).find((t) => t.id === 'AG-27')!;
        expect(task.error).toBeNull();
        expect(task.status).toBe('todo');
        expect(task.blockedReason).toBe('build-box offline');
      });

      it('resolves an item without a task and is idempotent', async () => {
        const id = await openItem(null, 'offline');
        const first = await call<AttentionItem>('post', `/dashboard/attention/${id}/resolve`);
        expect(first.resolved).toBe(true);
        const second = await call<AttentionItem>('post', `/dashboard/attention/${id}/resolve`);
        expect(second).toEqual(first);
      });

      it('resolves an item whose task is gone', async () => {
        const id = await openItem('AG-999');
        const resolved = await call<AttentionItem>('post', `/dashboard/attention/${id}/resolve`);
        expect(resolved.resolved).toBe(true);
      });

      it('answers 404 for unknown, malformed and foreign ids', async () => {
        const id = await openItem(null, 'offline');
        const other = await registerAndLogin(app);
        for (const [path, client] of [
          [`/dashboard/attention/${randomUUID()}/resolve`, me],
          ['/dashboard/attention/nope/resolve', me],
          [`/dashboard/attention/${id}/resolve`, other],
        ] as const) {
          const response = await request(app.getHttpServer())
            .post(`/api/v1${path}`)
            .set(client.bearer);
          expect(response.status).toBe(404);
          expect((response.body as { message: string }).message).toBe('Not found');
        }
        // The foreign attempt did not resolve it.
        expect((await summary()).attention.map((x) => x.id)).toContain(id);
      });

      it('requires authentication', async () => {
        await request(app.getHttpServer()).get('/api/v1/dashboard').expect(401);
        await request(app.getHttpServer())
          .post(`/api/v1/dashboard/attention/${randomUUID()}/resolve`)
          .expect(401);
      });
    });
  });
});
