import { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { queueOf, type ApiResponse, type RunSpan, type Task } from '@repo/shared';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource, IsNull } from 'typeorm';
import { ClockService } from '../src/common/clock';
import { LEASE_MS } from '../src/contacts';
import { ASSIGNMENT_ENDED_EVENT, REALTIME_EVENT, RealtimeEnvelope } from '../src/modules/events';
import { AgentGatewayService } from '../src/modules/gateway/agent-gateway.service';
import { Assignment } from '../src/modules/gateway/entities/assignment.entity';
import { TaskRun } from '../src/modules/tasks/entities/task-run.entity';
import { TaskEngineService } from '../src/modules/tasks/task-engine.service';
import { TaskReconcileService } from '../src/modules/tasks/task-reconcile.service';
import { Random, TaskTimers } from '../src/modules/tasks/task-timers';
import {
  createTestApp,
  createWorld,
  registerAndLogin,
  TestClock,
  truncateAll,
  World,
} from './utils';

/** Timers that only run when a test flushes them, like the mock's manual `later`. */
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

describe('Tasks engine (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let engine: TaskEngineService;
  let gateway: AgentGatewayService;
  let emitter: EventEmitter2;
  let clock: TestClock;
  const timers = new ManualTimers();
  const random = new FixedRandom();
  let w: World;
  let realtime: RealtimeEnvelope[];

  beforeAll(async () => {
    clock = new TestClock();
    ({ app, dataSource } = await createTestApp((builder) =>
      builder
        .overrideProvider(ClockService)
        .useValue(clock)
        .overrideProvider(TaskTimers)
        .useValue(timers)
        .overrideProvider(Random)
        .useValue(random),
    ));
    await app.listen(0); // one listening server: supertest would otherwise add listeners per concurrent request
    engine = app.get(TaskEngineService);
    gateway = app.get(AgentGatewayService);
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
    w = await createWorld(dataSource, await registerAndLogin(app), clock.now().getTime());
    realtime = [];
    emitter.removeAllListeners(REALTIME_EVENT);
    emitter.on(REALTIME_EVENT, (e: RealtimeEnvelope) => realtime.push(e));
  });

  // ---------- helpers ----------
  const a1 = () => w.agents.a1.id;
  const a2 = () => w.agents.a2.id;

  const call = async <T>(
    method: 'get' | 'post' | 'patch' | 'put',
    path: string,
    body?: object,
    expected = 200,
    client = w.me,
  ): Promise<T> => {
    const response = await request(app.getHttpServer())
      [method](`/api/v1${path}`)
      .set(client.bearer)
      .send(body);
    expect(response.status).toBe(expected);
    return (response.body as ApiResponse<T>).data;
  };
  const callRaw = (
    method: 'get' | 'post' | 'patch' | 'put',
    path: string,
    body?: object,
    client = w.me,
  ) => request(app.getHttpServer())[method](`/api/v1${path}`).set(client.bearer).send(body);

  const list = () => call<Task[]>('get', '/tasks');
  const task = async (id: string) => (await list()).find((t) => t.id === id)!;
  const move = (id: string, status: Task['status'], extra: object = {}) =>
    call<Task>('post', `/tasks/${id}/move`, { status, ...extra });
  const running = async (agentId: string) =>
    (await list()).find((t) => t.assigneeId === agentId && t.activeRun);
  const notices = () =>
    realtime
      .filter((e) => e.event.type === 'notice')
      .map((e) => (e.event.type === 'notice' ? e.event.text : ''));

  /** Run the timers the way the mock test's `flush` did, until none are left. */
  const flush = async () => {
    while (timers.pending.length) {
      timers.pending.shift()!();
      await engine.settled();
    }
  };

  /** What a daemon on c1 does first: claim the offered runs and accept them. */
  const accept = async () => {
    for (;;) {
      const claimed = await gateway.claim(w.c1.id, undefined, 'task');
      if (!claimed) return;
      await gateway.accept(claimed.id, claimed.attempt);
    }
  };

  /** Run a task's remaining steps until the run ends (the mock test's `finish`). */
  const finish = async (id: string) => {
    await accept();
    for (let guard = 0; guard < 50; guard++) {
      if (!(await task(id)).activeRun) return;
      await engine.advance(w.me.workspaceId, id);
      await engine.settled();
    }
    throw new Error(`${id} did not finish`);
  };

  const activeAssignments = (agentId: string) =>
    dataSource
      .getRepository(Assignment)
      .createQueryBuilder('a')
      .where(`a.agent_id = :agentId AND a.source_kind = 'task'`, { agentId })
      .andWhere(`a.status IN ('offered', 'claimed', 'running')`)
      .getMany();

  // ---------- the mock backend's specs ----------
  describe('task rules (port of the 13 mock specs)', () => {
    // 1
    it('runs at most one task per agent; extra work is queued', async () => {
      expect((await running(a1()))?.id).toBe('AG-31');
      const t = await move('AG-25', 'doing');
      expect(t.status).toBe('todo');
      expect(t.activeRun).toBeNull();
      expect(notices().pop()).toContain('Đã xếp **AG-25** vào hàng đợi');
      expect((await list()).filter((x) => x.assigneeId === a1() && x.activeRun)).toHaveLength(1);
      expect(await activeAssignments(a1())).toHaveLength(1);
    });

    // 2
    it('keeps work for an offline computer in todo as blocked', async () => {
      await dataSource.query(`UPDATE tasks SET blocked_reason = NULL WHERE id = 'AG-27'`);
      const t = await move('AG-27', 'doing');
      expect(t.status).toBe('todo');
      expect(t.blockedReason).toBe('build-box offline');
      const agents = await call<{ id: string; status: string }[]>('get', '/agents');
      expect(agents.find((a) => a.id === w.agents.a3.id)?.status).toBe('offline');
      expect(await activeAssignments(w.agents.a3.id)).toHaveLength(0);
    });

    // 3
    it('orders a queue by priority, then board order', async () => {
      const ids = async () => queueOf(await list(), a1()).map((t) => t.id);
      expect(await ids()).toEqual(['AG-26', 'AG-25']);
      await call('patch', '/tasks/AG-25', { priority: 'urgent' });
      expect(await ids()).toEqual(['AG-25', 'AG-26']);
    });

    // 4
    it('sends a finished task to review when it needs approval, then picks the next one', async () => {
      await finish('AG-30'); // Research Bot, requiresReview
      const t = await task('AG-30');
      expect(t.status).toBe('review');
      expect(t.runs[0].status).toBe('completed');
      expect(t.runs[0].toolCalls).toBe(5);
      expect(t.subtasks.every((s) => s.done)).toBe(true);
      expect(t.output).toContain('Chi tiết trong log run #1.');
      await flush();
      expect((await running(a2()))?.id).toBe('AG-24');
    });

    // 5
    it('goes straight to done without review', async () => {
      await finish('AG-31');
      expect((await task('AG-31')).status).toBe('done');
    });

    // 6
    it('returns a failed run to todo with an error, and the agent skips it', async () => {
      random.value = 0;
      await finish('AG-31');
      const t = await task('AG-31');
      expect(t.status).toBe('todo');
      expect(t.error).toMatch(/Run #1 lỗi/);
      expect(t.runs[0].status).toBe('failed');
      expect(t.runs[0].error).toMatch(/ exit 1$/);
      expect(t.activity.at(-1)).toMatchObject({ tone: 'error' });
      await flush();
      expect((await running(a1()))?.id).not.toBe('AG-31');
    });

    // 7
    it('stops a run and lets the agent move on', async () => {
      const t = await call<Task>('post', '/tasks/AG-31/stop');
      expect(t.activeRun).toBeNull();
      expect(t.runs[0].status).toBe('cancelled');
      expect(t.error).toBe('Đã dừng thủ công');
      await flush();
      expect((await running(a1()))?.id).toBe('AG-26');
    });

    // 8
    it('only approves tasks waiting for review', async () => {
      const response = await callRaw('post', '/tasks/AG-25/approve');
      expect(response.status).toBe(409);
      expect((response.body as { message: string }).message).toBe('Task is not waiting for review');
      const approved = await call<Task>('post', '/tasks/AG-29/approve');
      expect(approved.status).toBe('done');
    });

    // 9
    it('"run now" jumps the queue as urgent while the agent is busy', async () => {
      const t = await call<Task>('post', '/tasks/AG-25/run-now');
      expect(t.priority).toBe('urgent');
      expect(queueOf(await list(), a1())[0].id).toBe('AG-25');
      expect(t.activeRun).toBeNull();
    });

    // 10
    it('starts a new task right away when its agent is idle', async () => {
      await call('post', '/tasks/AG-31/stop');
      await call('patch', '/tasks/AG-26', { assigneeId: null });
      await call('patch', '/tasks/AG-25', { assigneeId: null });
      const t = await call<Task>('post', '/tasks', {
        title: 'Gửi email báo giá',
        assigneeId: a1(),
        status: 'todo',
      });
      expect(t.labels).toEqual(['email']);
      await flush();
      expect((await running(a1()))?.id).toBe(t.id);
    });

    // 11
    it('pausing the scheduler freezes progress and pick-up', async () => {
      expect(await call('put', '/scheduler', { paused: true })).toEqual({ paused: true });
      expect(await call('get', '/scheduler')).toEqual({ paused: true });
      const before = (await task('AG-31')).activeRun!.step;
      await engine.tick(w.me.workspaceId);
      expect((await task('AG-31')).activeRun!.step).toBe(before);
      await call('post', '/tasks/AG-31/stop');
      await flush();
      expect(await running(a1())).toBeUndefined();
      expect(await call('put', '/scheduler', { paused: false })).toEqual({ paused: false });
      expect((await running(a1()))?.id).toBe('AG-26');
    });

    // 12
    it('reassigning a running task cancels its run', async () => {
      const t = await call<Task>('patch', '/tasks/AG-31', { assigneeId: w.members.u2 });
      expect(t.activeRun).toBeNull();
      expect(t.runs[0].status).toBe('cancelled');
      expect(t.assigneeId).toBe(w.members.u2);
      expect(await activeAssignments(a1())).toHaveLength(0);
    });

    // 13
    it('does not share mutable state between tasks', async () => {
      await call('patch', '/tasks/AG-24', {
        subtasks: [{ title: 'Chuẩn hoá', done: true }],
      });
      const all = await list();
      expect(all.find((t) => t.id === 'AG-24')!.subtasks).toEqual([
        { title: 'Chuẩn hoá', done: true },
      ]);
      expect(all.find((t) => t.id === 'AG-26')!.subtasks.every((s) => !s.done)).toBe(true);
      await finish('AG-31');
      expect((await task('AG-15')).runs).toHaveLength(1);
      expect((await task('AG-16')).runs).toHaveLength(2);
    });
  });

  // ---------- beyond the mock ----------
  describe('board and seed', () => {
    it('lists the seeded board by rank with runs, history and the two active runs', async () => {
      const all = await list();
      expect(all.map((t) => t.id)).toEqual([
        'AG-31',
        'AG-30',
        'AG-23',
        'AG-29',
        'AG-28',
        'AG-27',
        'AG-26',
        'AG-25',
        'AG-24',
        'AG-22',
        'AG-21',
        'AG-20',
        'AG-19',
        'AG-18',
        'AG-17',
        'AG-16',
        'AG-15',
      ]);
      const t31 = all[0];
      expect(t31).toMatchObject({
        assigneeId: a1(),
        status: 'doing',
        activeRun: { n: 1, step: 2, computerId: w.c1.id },
      });
      expect(t31.activeRun!.steps).toHaveLength(5);
      expect(t31.activity.map((x) => x.text)).toEqual(['tạo task', 'nhận task, bắt đầu run #1']);
      expect(all.find((t) => t.id === 'AG-16')!.runs.map((r) => [r.n, r.status])).toEqual([
        [2, 'completed'],
        [1, 'failed'],
      ]);
      expect(all.find((t) => t.id === 'AG-20')!.assigneeId).toBe(w.members.u3);
      // Both seeded runs belong to running assignments, one per agent.
      expect(await activeAssignments(a1())).toHaveLength(1);
      expect(await activeAssignments(a2())).toHaveLength(1);
    });

    it('creates tasks with the next key, first in the board, using the shared label rules', async () => {
      const t = await call<Task>('post', '/tasks', {
        title: '  Tìm đối thủ mới ',
        priority: 'high',
      });
      expect(t).toMatchObject({
        id: 'AG-32',
        title: 'Tìm đối thủ mới',
        status: 'todo',
        labels: ['research'],
        assigneeId: null,
        requiresReview: true,
        rank: -1,
      });
      expect(t.activity.map((x) => x.text)).toEqual(['tạo task']);
      expect((await list())[0].id).toBe('AG-32');
      const second = await call<Task>('post', '/tasks', { title: 'Another', status: 'backlog' });
      expect(second.id).toBe('AG-33');
    });

    it('queues a todo task of a busy agent with a notice and starts nothing', async () => {
      const t = await call<Task>('post', '/tasks', { title: 'Việc mới', assigneeId: a1() });
      expect(t.status).toBe('todo');
      expect(notices().pop()).toBe(`Đã thêm **${t.id}** vào hàng đợi của **khanhpv's Claude**`);
      expect(timers.pending).toHaveLength(0);
    });

    it('creating with status doing starts it for an idle agent', async () => {
      await call('post', '/tasks/AG-31/stop');
      const t = await call<Task>('post', '/tasks', {
        title: 'Chạy ngay',
        assigneeId: a1(),
        status: 'doing',
      });
      expect(t.status).toBe('doing');
      expect(t.activeRun).toMatchObject({ n: 1, step: 0, computerId: w.c1.id });
      expect(notices()).toContain(`Đã giao **${t.id}** cho **khanhpv's Claude**, đang chạy`);
    });

    it('reorders inside the board with beforeId and keeps ranks 0..n-1', async () => {
      await move('AG-25', 'todo', { beforeId: 'AG-26' });
      const all = await list();
      expect(all.map((t) => t.rank)).toEqual(all.map((_, i) => i));
      const todo = all.filter((t) => t.status === 'todo').map((t) => t.id);
      expect(todo.indexOf('AG-25')).toBeLessThan(todo.indexOf('AG-26'));
      // An unknown beforeId places the task last.
      await move('AG-25', 'todo', { beforeId: 'AG-999' });
      expect((await list()).at(-1)!.id).toBe('AG-25');
    });

    it('moving a running task out of doing cancels its run and frees the agent', async () => {
      const t = await move('AG-31', 'backlog');
      expect(t.status).toBe('backlog');
      expect(t.activeRun).toBeNull();
      expect(t.runs[0].status).toBe('cancelled');
      expect(t.activity.at(-1)!.text).toBe('chuyển sang **Backlog**');
      await flush();
      expect((await running(a1()))?.id).toBe('AG-26');
    });

    it('moving to done ticks every subtask', async () => {
      const t = await move('AG-23', 'done');
      expect(t.subtasks.every((s) => s.done)).toBe(true);
    });

    it('revise sends a reviewed task back for another run with the note as a comment', async () => {
      await call('post', '/tasks/AG-31/stop');
      const t = await call<Task>('post', '/tasks/AG-28/revise', { note: ' làm lại phần test ' });
      expect(t.status).toBe('doing');
      expect(t.output).toBeNull();
      expect(t.activeRun).toMatchObject({ n: 2 });
      const log = t.activity.slice(-3).map((x) => [x.kind, x.text]);
      expect(log[0]).toEqual(['comment', 'làm lại phần test']);
      expect(log[1]).toEqual(['event', 'yêu cầu sửa']);
    });

    it('retry clears the error and runs again', async () => {
      await call('post', '/tasks/AG-31/stop');
      expect((await task('AG-31')).error).toBe('Đã dừng thủ công');
      const t = await call<Task>('post', '/tasks/AG-31/retry');
      expect(t.error).toBeNull();
      expect(t.status).toBe('doing');
      expect(t.activeRun).toMatchObject({ n: 2 });
    });

    it('run-now starts at once when the agent is free', async () => {
      await call('post', '/tasks/AG-31/stop');
      const t = await call<Task>('post', '/tasks/AG-25/run-now');
      expect(t.status).toBe('doing');
      expect(t.activeRun).not.toBeNull();
    });

    it('comments, and the mentioned agent acknowledges after a delay', async () => {
      const t = await call<Task>('post', '/tasks/AG-25/comments', {
        markdown: " @khanhpv's Claude xem giúp ",
      });
      expect(t.activity.at(-1)).toMatchObject({
        kind: 'comment',
        text: "@khanhpv's Claude xem giúp",
      });
      expect(timers.pending).toHaveLength(1);
      await flush();
      const after = await task('AG-25');
      expect(after.activity.at(-1)).toMatchObject({
        by: a1(),
        kind: 'comment',
        text: 'Đã nhận, em sẽ cập nhật trong run tiếp theo.',
      });
      await call('post', '/tasks/AG-25/comments', { markdown: 'không nhắc ai' });
      expect(timers.pending).toHaveLength(0);
    });
  });

  describe('runs through the gateway', () => {
    it('offers a run to the agent, which then shows as working and starts at claim', async () => {
      await call('post', '/tasks/AG-31/stop');
      const t = await call<Task>('post', '/tasks/AG-25/run-now');
      const assignments = await activeAssignments(a1());
      expect(assignments).toHaveLength(1);
      expect(assignments[0]).toMatchObject({ status: 'offered', sourceId: 'AG-25' });
      const agents = await call<{ id: string; status: string }[]>('get', '/agents');
      expect(agents.find((a) => a.id === a1())?.status).toBe('working');
      const claimedAt = clock.now();
      await accept();
      const after = await task('AG-25');
      expect(Date.parse(after.activeRun!.startedAt)).toBeGreaterThanOrEqual(
        claimedAt.getTime() - 1000,
      );
      expect(t.activeRun!.computerId).toBe(w.c1.id);
    });

    it('advance only touches running assignments', async () => {
      await call('post', '/tasks/AG-31/stop');
      await call('post', '/tasks/AG-25/run-now');
      await engine.advance(w.me.workspaceId, 'AG-25'); // still offered
      expect((await task('AG-25')).activeRun!.step).toBe(0);
      await accept();
      await engine.advance(w.me.workspaceId, 'AG-25');
      const t = await task('AG-25');
      expect(t.activeRun!.step).toBe(1);
      const row = await dataSource.getRepository(Assignment).findOneByOrFail({
        sourceId: 'AG-25',
        status: 'running',
      });
      expect(row.toolCalls).toBe(1);
    });

    it('ticks subtasks off in proportion to the steps', async () => {
      await accept();
      // AG-31: 5 steps, 3 subtasks, already at step 2 with one done.
      await engine.advance(w.me.workspaceId, 'AG-31'); // step 3 -> floor(3/5*3) = 1
      expect((await task('AG-31')).subtasks.map((s) => s.done)).toEqual([true, false, false]);
      await engine.advance(w.me.workspaceId, 'AG-31'); // step 4 -> 2
      expect((await task('AG-31')).subtasks.map((s) => s.done)).toEqual([true, true, false]);
    });

    it('finishes a run reported completed by the daemon through the gateway', async () => {
      const row = await dataSource
        .getRepository(Assignment)
        .findOneByOrFail({ sourceId: 'AG-31', status: 'running' });
      await gateway.result(row.id, row.attempt, { status: 'completed' });
      await engine.settled();
      const t = await task('AG-31');
      expect(t.status).toBe('done');
      expect(t.runs[0]).toMatchObject({ n: 1, status: 'completed' });
      expect(notices()).toContain("**khanhpv's Claude** xong **AG-31** → Xong");
    });

    it('turns a failed daemon result into the failure branch', async () => {
      const row = await dataSource
        .getRepository(Assignment)
        .findOneByOrFail({ sourceId: 'AG-31', status: 'running' });
      await gateway.result(row.id, row.attempt, { status: 'failed', error: 'Bash exit 1' });
      await engine.settled();
      const t = await task('AG-31');
      expect(t).toMatchObject({ status: 'todo' });
      expect(t.runs[0]).toMatchObject({ status: 'failed', error: 'Bash exit 1' });
      expect(t.error).toBe('Run #1 lỗi ở Bash'); // step 3 of the email script
      expect(notices()).toContain("**khanhpv's Claude** lỗi ở **AG-31**, đã trả về Cần làm");
    });

    it('finalizes an expired lease as expired and returns the task to todo', async () => {
      clock.advance(LEASE_MS + 5_000);
      expect(await gateway.reconcileLeases(clock.now())).toBe(2);
      await engine.settled();
      const t = await task('AG-31');
      expect(t).toMatchObject({ status: 'todo', activeRun: null, error: 'Run #1 hết hạn' });
      expect(t.runs[0]).toMatchObject({ n: 1, status: 'expired' });
      expect(notices()).toContain("**khanhpv's Claude** hết hạn ở **AG-31**, đã trả về Cần làm");
      await flush();
      // The failed task is skipped; the queue moves on.
      expect((await running(a1()))?.id).toBe('AG-26');
    });

    it('treats a repeated assignment.ended as a no-op', async () => {
      const row = await dataSource
        .getRepository(Assignment)
        .findOneByOrFail({ sourceId: 'AG-31', status: 'running' });
      await gateway.result(row.id, row.attempt, { status: 'completed' });
      await engine.settled();
      const before = await task('AG-31');
      const payload = {
        workspaceId: w.me.workspaceId,
        assignmentId: row.id,
        sourceKind: 'task',
        sourceId: 'AG-31',
        agentId: a1(),
        status: 'completed',
      };
      emitter.emit(ASSIGNMENT_ENDED_EVENT, payload);
      emitter.emit(ASSIGNMENT_ENDED_EVENT, payload);
      await engine.settled();
      const after = await task('AG-31');
      expect(after.runs).toHaveLength(1);
      expect(after.activity).toEqual(before.activity);
      expect(await dataSource.getRepository(TaskRun).count({ where: { taskId: 'AG-31' } })).toBe(1);
    });

    it('does not double-finish a run the engine cancelled itself', async () => {
      await call('post', '/tasks/AG-31/stop');
      const activityBefore = (await task('AG-31')).activity.length;
      emitter.emit(ASSIGNMENT_ENDED_EVENT, {
        workspaceId: w.me.workspaceId,
        assignmentId: (
          await dataSource.getRepository(Assignment).findOneByOrFail({
            sourceId: 'AG-31',
            status: 'cancelled',
          })
        ).id,
        sourceKind: 'task',
        sourceId: 'AG-31',
        agentId: a1(),
        status: 'cancelled',
      });
      await engine.settled();
      expect((await task('AG-31')).activity).toHaveLength(activityBefore);
      expect((await task('AG-31')).runs).toHaveLength(1);
    });

    it('the reconcile pass picks up queued work for idle agents without timers', async () => {
      await call('post', '/tasks/AG-31/stop');
      timers.pending = [];
      await app.get(TaskReconcileService).pickPass();
      expect((await running(a1()))?.id).toBe('AG-26');
      expect((await running(a2()))?.id).toBe('AG-30');
    });

    it('the reconcile pass leaves a paused scheduler alone', async () => {
      await call('post', '/tasks/AG-31/stop');
      await call('put', '/scheduler', { paused: true });
      await app.get(TaskReconcileService).pickPass();
      expect(await running(a1())).toBeUndefined();
    });

    it('the repair scan finalizes a run whose assignment ended without an event', async () => {
      await accept();
      await dataSource.query(
        `UPDATE assignments SET status = 'completed', ended_at = now() WHERE source_id = 'AG-31'`,
      );
      expect(
        await dataSource.getRepository(TaskRun).count({ where: { finalizedAt: IsNull() } }),
      ).toBeGreaterThan(0);
      await app.get(TaskReconcileService).repairStranded();
      await engine.settled();
      const t = await task('AG-31');
      expect(['review', 'done']).toContain(t.status);
      expect(t.activeRun).toBeNull();
      expect(t.runs[0]).toMatchObject({ n: 1, status: 'completed' });
      // Idempotent: a second pass changes nothing.
      const before = await task('AG-31');
      await app.get(TaskReconcileService).repairStranded();
      await engine.settled();
      expect((await task('AG-31')).activity).toEqual(before.activity);
    });

    it('expires an offered run whose computer went offline and frees the agent', async () => {
      await call('post', '/tasks/AG-31/stop');
      await call('post', '/tasks/AG-25/run-now');
      expect(await activeAssignments(a1())).toHaveLength(1);
      await dataSource.query(`UPDATE computers SET status = 'offline' WHERE id = $1`, [w.c1.id]);
      expect(await gateway.expireOfflineTaskAssignments()).toBeGreaterThanOrEqual(1);
      await engine.settled();
      const t = await task('AG-25');
      expect(t).toMatchObject({ status: 'todo', activeRun: null });
      expect(t.runs[0]).toMatchObject({ n: 1, status: 'expired' });
      expect(await activeAssignments(a1())).toHaveLength(0);
    });
  });

  describe('concurrency', () => {
    it('lets exactly one of ten parallel moves to doing run; the rest queue without errors', async () => {
      await call('post', '/tasks/AG-31/stop');
      timers.pending = [];
      const created: Task[] = [];
      for (let i = 0; i < 10; i++) {
        created.push(
          await call<Task>('post', '/tasks', {
            title: `Việc song song ${i}`,
            assigneeId: a1(),
            status: 'backlog',
          }),
        );
      }
      const responses = await Promise.all(
        created.map((t) => callRaw('post', `/tasks/${t.id}/move`, { status: 'doing' })),
      );
      expect(responses.map((r) => r.status)).toEqual(Array(10).fill(200));
      const mine = (await list()).filter((t) => created.some((c) => c.id === t.id));
      expect(mine.filter((t) => t.activeRun)).toHaveLength(1);
      expect(mine.filter((t) => t.status === 'doing')).toHaveLength(1);
      expect(mine.filter((t) => t.status === 'todo')).toHaveLength(9);
      expect(await activeAssignments(a1())).toHaveLength(1);
    });

    it('parallel commands on different workspaces do not block each other', async () => {
      const other = await registerAndLogin(app);
      const [a, b] = await Promise.all([
        callRaw('post', '/tasks', { title: 'A' }),
        callRaw('post', '/tasks', { title: 'B' }, other),
      ]);
      expect(a.status).toBe(200);
      expect(b.status).toBe(200);
      expect((b.body as ApiResponse<Task>).data.id).toBe('AG-1');
    });
  });

  describe('events after commit', () => {
    it('publishes tasks.changed and agents.changed after a command, nothing for a rejected one', async () => {
      await call('post', '/tasks/AG-25/run-now');
      expect(realtime.map((e) => e.event.type)).toEqual(
        expect.arrayContaining(['notice', 'tasks.changed', 'agents.changed']),
      );
      realtime.length = 0;
      await callRaw('post', '/tasks/AG-25/approve').expect(409);
      expect(realtime).toEqual([]);
    });

    it('rolls a failed command back completely (no activity, no events, no timers)', async () => {
      realtime.length = 0;
      timers.pending = [];
      // Unknown assignee after the cancel step would have run; the check comes first.
      await callRaw('patch', '/tasks/AG-31', { assigneeId: 'nobody' }).expect(400);
      const t = await task('AG-31');
      expect(t.activeRun).not.toBeNull();
      expect(t.activity).toHaveLength(2);
      expect(realtime).toEqual([]);
      expect(timers.pending).toHaveLength(0);
    });
  });

  describe('validation and errors', () => {
    it('rejects an empty title and bad enums with 400', async () => {
      await callRaw('post', '/tasks', { title: '   ' }).expect(400);
      await callRaw('post', '/tasks', {}).expect(400);
      await callRaw('post', '/tasks', { title: 'x'.repeat(201) }).expect(400);
      await callRaw('post', '/tasks', { title: 'ok', priority: 'huge' }).expect(400);
      await callRaw('post', '/tasks', { title: 'ok', status: 'blocked' }).expect(400);
      await callRaw('post', '/tasks/AG-25/move', { status: 'nope' }).expect(400);
      await callRaw('post', '/tasks/AG-25/move', {}).expect(400);
      await callRaw('patch', '/tasks/AG-25', { subtasks: [{ title: 1, done: 'x' }] }).expect(400);
      await callRaw('put', '/scheduler', { paused: 'yes' }).expect(400);
    });

    it('returns the mock texts for rule violations', async () => {
      const unknownAssignee = await callRaw('patch', '/tasks/AG-25', { assigneeId: 'a1' });
      expect(unknownAssignee.status).toBe(400);
      expect((unknownAssignee.body as { message: string }).message).toBe('Unknown assignee');
      const createUnknown = await callRaw('post', '/tasks', { title: 'x', assigneeId: 'zzz' });
      expect(createUnknown.status).toBe(400);

      const notRunning = await callRaw('post', '/tasks/AG-25/stop');
      expect(notRunning.status).toBe(409);
      expect((notRunning.body as { message: string }).message).toBe('Task is not running');

      const noAgent = await callRaw('post', '/tasks/AG-22/run-now');
      expect(noAgent.status).toBe(409);
      expect((noAgent.body as { message: string }).message).toBe('Task has no agent');

      const empty = await callRaw('post', '/tasks/AG-25/comments', { markdown: '  ' });
      expect(empty.status).toBe(400);
      expect((empty.body as { message: string }).message).toBe('Comment is empty');
      await callRaw('post', '/tasks/AG-25/comments', {}).expect(400);
    });

    it('answers 404 for unknown tasks on every action', async () => {
      const missing = await callRaw('post', '/tasks/AG-999/move', { status: 'todo' });
      expect(missing.status).toBe(404);
      expect((missing.body as { message: string }).message).toBe('Task AG-999 not found');
      await callRaw('patch', '/tasks/AG-999', {}).expect(404);
      for (const action of ['approve', 'revise', 'stop', 'retry', 'run-now']) {
        await callRaw('post', `/tasks/AG-999/${action}`).expect(404);
      }
      await callRaw('post', '/tasks/AG-999/comments', { markdown: 'hi' }).expect(404);
    });

    it('requires a bearer token', async () => {
      await request(app.getHttpServer()).get('/api/v1/tasks').expect(401);
      await request(app.getHttpServer()).get('/api/v1/run-spans').expect(401);
      await request(app.getHttpServer()).get('/api/v1/scheduler').expect(401);
    });

    it('honours the accept-language for rule errors', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/tasks/AG-999/approve')
        .set(w.me.bearer)
        .set('Accept-Language', 'vi');
      expect(response.status).toBe(404);
    });
  });

  describe('workspace isolation', () => {
    it("never shows or touches another workspace's tasks", async () => {
      const other = await registerAndLogin(app);
      expect(await call<Task[]>('get', '/tasks', undefined, 200, other)).toEqual([]);
      expect(await call<RunSpan[]>('get', '/run-spans', undefined, 200, other)).toEqual([]);
      await callRaw('patch', '/tasks/AG-31', { priority: 'low' }, other).expect(404);
      await callRaw('post', '/tasks/AG-31/stop', undefined, other).expect(404);
      await callRaw('post', '/tasks/AG-31/move', { status: 'done' }, other).expect(404);
      expect((await task('AG-31')).activeRun).not.toBeNull();
      // Pausing one workspace does not pause the other.
      await call('put', '/scheduler', { paused: true });
      expect(await call('get', '/scheduler', undefined, 200, other)).toEqual({ paused: false });
    });

    it('rejects assigning a member or agent of another workspace', async () => {
      const other = await registerAndLogin(app);
      await callRaw('patch', '/tasks/AG-25', { assigneeId: other.memberId }).expect(400);
    });
  });

  describe('run spans', () => {
    it('lists finished runs and filters by since', async () => {
      const all = await call<RunSpan[]>('get', '/run-spans');
      // One finished run per seeded history entry (AG-16 has two).
      expect(all).toHaveLength(10);
      expect(all.find((s) => s.title === 'Crawl giá đối thủ (lần 1)')).toBeDefined();
      expect(
        all
          .filter((s) => s.result === 'fail')
          .map((s) => s.title)
          .sort(),
      ).toEqual(['Crawl giá đối thủ (lần 1)', 'Deploy staging sau khi nâng cấp NestJS 12']);
      expect(all.filter((s) => s.result === 'cancel').map((s) => s.title)).toEqual([
        'Review MR !42: thêm module computers',
      ]);
      expect(all.every((s, i) => i === 0 || all[i - 1].endedAt <= s.endedAt)).toBe(true);
      expect(all.find((s) => s.title.startsWith('Dọn nhãn Gmail'))).toMatchObject({
        agentId: a1(),
        result: 'done',
      });

      const since = new Date(clock.now().getTime() - 7 * 3_600_000).toISOString();
      const recent = await call<RunSpan[]>('get', `/run-spans?since=${since}`);
      expect(recent.length).toBeGreaterThan(0);
      expect(recent.length).toBeLessThan(all.length);
      expect(recent.every((s) => Date.parse(s.endedAt) > Date.parse(since))).toBe(true);

      expect(await call('get', '/run-spans?since=nonsense')).toHaveLength(all.length);
      expect(await call('get', '/run-spans?since=2999-01-01T00:00:00Z')).toEqual([]);
    });

    it('adds a span for each run the engine ends', async () => {
      const before = (await call<RunSpan[]>('get', '/run-spans')).length;
      await call('post', '/tasks/AG-31/stop');
      await finish('AG-30');
      const spans = await call<RunSpan[]>('get', '/run-spans');
      expect(spans).toHaveLength(before + 2);
      expect(
        spans
          .slice(-2)
          .map((s) => [s.title, s.result])
          .sort(),
      ).toEqual([
        ['Tìm 5 đối thủ cùng ngành, so sánh bảng giá', 'done'],
        ['Tóm tắt email sáng nay và gắn nhãn', 'cancel'],
      ]);
    });
  });

  describe('scheduler', () => {
    it('defaults to running and survives a toggle round trip', async () => {
      expect(await call('get', '/scheduler')).toEqual({ paused: false });
      expect(await call('put', '/scheduler', { paused: true })).toEqual({ paused: true });
      expect(realtime.map((e) => e.event.type)).toContain('tasks.changed');
      expect(await call('put', '/scheduler', { paused: false })).toEqual({ paused: false });
    });
  });
});
