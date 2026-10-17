import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { EventEmitter2 } from '@nestjs/event-emitter';
import {
  currentStep,
  firstRank,
  inferLabel,
  pickableOf,
  placeBefore,
  PRIORITY_NAME,
  queueOf,
  runningOf,
  STATUS_NAME,
  statusAfterRun,
  stepsFor,
  subtasksDue,
  type CreateTaskInput,
  type RealtimeEvent,
  type Task,
  type TaskActivity,
  type TaskRunStatus,
  type TaskStatus,
  type ToolCall,
  type UpdateTaskInput,
} from '@repo/shared';
import { EntityManager, In, IsNull, Not } from 'typeorm';
import type { ClockService } from '../../common/clock';
import { returnedRows } from '../../common/utils';
import { Agent } from '../agents/entities/agent.entity';
import { turnConnectionOff } from '../connections/connection-room';
import { WorkspaceConnection } from '../connections/entities/workspace-connection.entity';
import { ensureDmRoom } from '../chat/dm-room';
import type { EventsService } from '../events';
import type { AgentGatewayService, Effect, GatewayTx } from '../gateway/agent-gateway.service';
import { Assignment, TERMINAL_STATUSES } from '../gateway/entities/assignment.entity';
import { Member } from '../workspace/entities/member.entity';
import { Workspace } from '../workspace/entities/workspace.entity';
import { TaskActivityRow } from './entities/task-activity.entity';
import { TaskRun } from './entities/task-run.entity';
import { TaskEntity } from './entities/task.entity';
import {
  MENTION_REPLY_MS,
  PICK_AFTER_FREE_MS,
  PICK_AFTER_RUN_MS,
  PICK_AFTER_TODO_MS,
  TASK_FAIL_RATE,
} from './task-constants';
import {
  TASK_APPROVED_EVENT,
  TASK_RUN_ENDED_EVENT,
  type TaskApprovedPayload,
  type TaskRunEndedPayload,
} from './task-events';
import { assigneeIdOf, toActiveRun } from './task.mapper';

export interface CommandDeps {
  clock: ClockService;
  gateway: AgentGatewayService;
  events: EventsService;
  emitter: EventEmitter2;
  random: () => number;
  /** Publishes tasks.changed + agents.changed, at most once per second per workspace. */
  coalesceChanged?: (workspaceId: string) => void;
  /** Re-enters the workspace lock after `ms`, with a fresh command. */
  schedule: (workspaceId: string, ms: number, run: (cmd: TaskCommand) => Promise<void>) => void;
}

/** Task fields a command may change; everything else is immutable after creation. */
const MUTABLE = [
  'title',
  'description',
  'status',
  'assigneeAgentId',
  'assigneeMemberId',
  'priority',
  'requiresReview',
  'subtasks',
  'output',
  'blockedReason',
  'error',
  'rank',
  'chatId',
  'labels',
] as const satisfies readonly (keyof TaskEntity)[];

type Snapshot = Record<string, string>;
const snapshotOf = (row: TaskEntity): Snapshot =>
  Object.fromEntries(MUTABLE.map((key) => [key, JSON.stringify(row[key])]));

const isInvalidTransition = (error: unknown): boolean =>
  error instanceof ConflictException &&
  (error.getResponse() as { message?: string }).message === 'gateway.INVALID_TRANSITION';

/** An agent acting for a member through a workspace tool: its writes are logged as the agent's. */
export interface Via {
  agentId: string;
  memberName: string;
}

/** A progress event of a real daemon, as the task run needs it. */
export type DaemonProgress = { kind: 'tool'; call: ToolCall } | { kind: 'turns'; turns: number };

const MAX_RUN_STEPS = 500;
const MAX_STEP_TOOL_CHARS = 100;
const MAX_STEP_INPUT_CHARS = 500;

const noAgent = () => new ConflictException({ message: 'tasks.NO_AGENT' });
const notRunning = () => new ConflictException({ message: 'tasks.NOT_RUNNING' });

/**
 * Port of the FE `MockBackend` rules onto the database. One instance lives for one command:
 * it loads the workspace board once, mutates the rows in memory with the shared rules, writes
 * back what changed, and collects events/timers to fire after the transaction commits.
 * Callers must run it inside `WorkspaceLockService.run`.
 */
export class TaskCommand {
  private workspace!: Workspace;
  private tasks: TaskEntity[] = [];
  private agents: Agent[] = [];
  private members: Member[] = [];
  /** Active runs (not finalized) by task id. */
  private activeRuns = new Map<string, TaskRun>();
  private assignments = new Map<string, Assignment>();
  private snapshots = new Map<string, Snapshot>();
  private touched = false;
  /** Simulator steps: the "changed" pings go through the coalescer instead of straight out. */
  coalesceChanges = false;
  /** Set when an agent performs the command for `by` (tool calls of a daemon run). */
  via: Via | null = null;

  constructor(
    private readonly deps: CommandDeps,
    private readonly manager: EntityManager,
    private readonly effects: Effect[],
    readonly workspaceId: string,
    /** Acting member; null for timers and the system. */
    private readonly by: string | null,
  ) {}

  private get tx(): GatewayTx {
    return { manager: this.manager, effects: this.effects };
  }

  private now(): Date {
    return this.deps.clock.now();
  }

  // ---------- loading and writing back ----------
  /**
   * `skipDone` (system commands that only pick, advance or finish runs) leaves finished tasks
   * out: they never take part in queues or runs. Commands that rank, create or look tasks up by
   * id (every user command, timers that comment) load the whole board. A done task that still
   * has an active run is always loaded so the run can be finished.
   */
  async load(options: { skipDone?: boolean } = {}): Promise<void> {
    const { manager, workspaceId } = this;
    this.workspace = await manager.findOneByOrFail(Workspace, { id: workspaceId });
    const runs = await manager.find(TaskRun, { where: { workspaceId, finalizedAt: IsNull() } });
    this.tasks = await manager.find(TaskEntity, {
      where: options.skipDone
        ? [
            { workspaceId, status: Not('done') },
            ...(runs.length ? [{ workspaceId, id: In(runs.map((run) => run.taskId)) }] : []),
          ]
        : { workspaceId },
      order: { rank: 'ASC', id: 'ASC' },
    });
    this.agents = await manager.find(Agent, {
      where: { workspaceId },
      relations: { computer: true },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
    this.members = await manager.find(Member, { where: { workspaceId } });
    this.activeRuns = new Map(runs.map((run) => [run.taskId, run]));
    if (runs.length) {
      const rows = await manager.find(Assignment, {
        where: { id: In(runs.map((run) => run.assignmentId)) },
      });
      this.assignments = new Map(rows.map((row) => [row.id, row]));
    }
    this.snapshots = new Map(this.tasks.map((row) => [row.id, snapshotOf(row)]));
  }

  /** Writes back the rows a command changed and queues the "something changed" events. */
  async flush(): Promise<void> {
    for (const row of this.tasks) {
      const before = this.snapshots.get(row.id);
      const now = snapshotOf(row);
      const changed = MUTABLE.filter((key) => !before || before[key] !== now[key]);
      if (!before || !changed.length) continue;
      await this.manager.update(
        TaskEntity,
        { workspaceId: this.workspaceId, id: row.id },
        Object.fromEntries(changed.map((key) => [key, row[key]])),
      );
      this.snapshots.set(row.id, now);
    }
    if (this.touched) {
      if (this.coalesceChanges && this.deps.coalesceChanged) {
        this.effects.push(() => this.deps.coalesceChanged?.(this.workspaceId));
      } else {
        this.publish({ type: 'tasks.changed' });
        this.publish({ type: 'agents.changed' });
      }
    }
  }

  // ---------- events ----------
  private publish(event: RealtimeEvent): void {
    this.effects.push(() => this.deps.events.publish(this.workspaceId, event));
  }

  private emit(name: string, payload: object): void {
    this.effects.push(() => this.deps.emitter.emit(name, payload));
  }

  notice(text: string, agentId: string | null, taskId: string | null): void {
    this.publish({ type: 'notice', text, agentId, taskId });
  }

  /** Broadcast that task data (and everything derived from it) changed. */
  changed(): void {
    this.touched = true;
  }

  private later(ms: number, run: (cmd: TaskCommand) => Promise<void>): void {
    this.effects.push(() => this.deps.schedule(this.workspaceId, ms, run));
  }

  private pickLater(agentId: string, ms: number): void {
    this.later(ms, (cmd) => cmd.pickNext(agentId));
  }

  /**
   * The acting member's DM with the agent: the chat a task assigned to that agent talks in.
   * Created on the command's transaction; the member (not the system) owns it, so timers
   * and other system commands get none.
   */
  private async dmWith(agent: Agent): Promise<string | null> {
    const memberId = this.by;
    if (!memberId) return null;
    const dm = await ensureDmRoom(this.manager, {
      workspaceId: this.workspaceId,
      memberId,
      agent,
      now: this.now(),
    });
    if (dm.created) {
      this.effects.push(() =>
        this.deps.events.publish(
          this.workspaceId,
          { type: 'rooms.changed' },
          { memberIds: [memberId] },
        ),
      );
    }
    return dm.id;
  }

  // ---------- lookups ----------
  agent(id: string | null | undefined): Agent | undefined {
    return id ? this.agents.find((a) => a.id === id) : undefined;
  }

  private memberExists(id: string): boolean {
    return this.members.some((m) => m.id === id);
  }

  isOnline(agent: Agent): boolean {
    return agent.computer.status === 'online';
  }

  task(id: string): TaskEntity {
    const row = this.tasks.find((t) => t.id === id);
    if (!row) throw new NotFoundException({ message: 'tasks.NOT_FOUND', args: { id } });
    return row;
  }

  private nameOf(id: string | null): string {
    if (!id) return 'Chưa giao';
    return this.agent(id)?.name ?? this.members.find((m) => m.id === id)?.name ?? id;
  }

  private activeRunOf(t: TaskEntity): TaskRun | undefined {
    return this.activeRuns.get(t.id);
  }

  /** Tasks in the contract shape the shared rules expect (history is not loaded). */
  private view(): Task[] {
    return this.tasks.map((row) => {
      const run = this.activeRuns.get(row.id);
      const assignment = run ? this.assignments.get(run.assignmentId) : undefined;
      return {
        id: row.id,
        title: row.title,
        description: row.description,
        status: row.status,
        assigneeId: assigneeIdOf(row),
        priority: row.priority,
        labels: row.labels,
        chatId: row.chatId,
        requiresReview: row.requiresReview,
        createdAt: row.createdAt.toISOString(),
        subtasks: row.subtasks,
        runs: [],
        activeRun:
          run && assignment
            ? toActiveRun(run, assignment)
            : run
              ? { n: run.n, startedAt: '', step: run.step, steps: run.steps, computerId: '' }
              : null,
        activity: [],
        output: row.output,
        blockedReason: row.blockedReason,
        error: row.error,
        rank: row.rank,
      };
    });
  }

  private rowOf(view: Task): TaskEntity {
    return this.task(view.id);
  }

  runningOf(agentId: string): TaskEntity | undefined {
    const found = runningOf(this.view(), agentId);
    return found && this.rowOf(found);
  }

  queueOf(agentId: string): TaskEntity[] {
    return queueOf(this.view(), agentId).map((t) => this.rowOf(t));
  }

  private setAssignee(t: TaskEntity, to: string | null): void {
    t.assigneeAgentId = to && this.agent(to) ? to : null;
    t.assigneeMemberId = to && !this.agent(to) ? to : null;
  }

  async log(
    t: TaskEntity,
    by: string | null,
    text: string,
    tone: TaskActivity['tone'] = 'normal',
    kind: TaskActivity['kind'] = 'event',
  ): Promise<void> {
    if (this.via && by !== null && by === this.by) {
      text = `(thay ${this.via.memberName}) ${text}`;
      by = this.via.agentId;
    }
    await this.manager.insert(TaskActivityRow, {
      workspaceId: this.workspaceId,
      taskId: t.id,
      by,
      kind,
      text,
      tone,
      at: this.now(),
    });
  }

  // ---------- run lifecycle ----------
  /** Creates and offers the run's assignment; the agent's runner picks it up from there. */
  async startRun(t: TaskEntity): Promise<void> {
    const agent = this.agent(t.assigneeAgentId);
    if (!agent) throw noAgent();
    t.status = 'doing';
    t.error = null;
    t.blockedReason = null;

    const created = await this.deps.gateway.create(
      {
        workspaceId: this.workspaceId,
        agentId: agent.id,
        sourceKind: 'task',
        sourceId: t.id,
        // Whoever starts the run speaks for it; timers and the queue fall back to the creator.
        requestedByMemberId: this.by ?? t.createdByMemberId,
      },
      this.tx,
    );
    const assignment = await this.deps.gateway.offer(created.id, this.tx);
    const rows = returnedRows<{ n: number }>(
      await this.manager.query(
        `SELECT COALESCE(MAX(n), 0) + 1 AS n FROM task_runs WHERE workspace_id = $1 AND task_id = $2`,
        [this.workspaceId, t.id],
      ),
    );
    const run = await this.manager.save(
      this.manager.create(TaskRun, {
        workspaceId: this.workspaceId,
        taskId: t.id,
        assignmentId: assignment.id,
        n: Number(rows[0].n),
        step: 0,
        // Real daemons report their own tool calls; only simulated runs follow a script.
        steps: agent.computer.simulated ? stepsFor(t.labels) : [],
        status: null,
        durationSec: null,
        toolCalls: null,
        error: null,
        finalizedAt: null,
      }),
    );
    this.activeRuns.set(t.id, run);
    this.assignments.set(assignment.id, assignment);
    this.changed();
    await this.log(t, agent.id, `nhận task, bắt đầu run #${run.n}`);
  }

  /** Finalizes the active run and ends its assignment when the daemon has not already. */
  private async endRun(
    t: TaskEntity,
    status: TaskRunStatus,
    error: string | null = null,
  ): Promise<{ n: number; durationSec: number; toolCalls: number }> {
    const run = this.activeRunOf(t);
    if (!run) throw notRunning();
    const assignment = this.assignments.get(run.assignmentId)!;
    if (status === 'cancelled' && !TERMINAL_STATUSES.includes(assignment.status)) {
      try {
        this.assignments.set(assignment.id, await this.deps.gateway.cancel(assignment.id, this.tx));
      } catch (error_) {
        // The daemon finished it a moment ago; the run is finalized as cancelled all the same.
        if (!isInvalidTransition(error_)) throw error_;
      }
    }
    const end = this.now();
    const started = assignment.startedAt ?? assignment.createdAt;
    const record = {
      n: run.n,
      durationSec: Math.max(0, Math.round((end.getTime() - started.getTime()) / 1000)),
      toolCalls: run.step,
    };
    await this.manager.update(
      TaskRun,
      { id: run.id },
      { status, durationSec: record.durationSec, toolCalls: run.step, error, finalizedAt: end },
    );
    this.activeRuns.delete(t.id);
    this.changed();
    const payload: TaskRunEndedPayload = {
      workspaceId: this.workspaceId,
      taskId: t.id,
      title: t.title,
      agentId: assignment.agentId,
      status,
      durationSec: record.durationSec,
    };
    this.emit(TASK_RUN_ENDED_EVENT, payload);
    return record;
  }

  private async cancelRun(t: TaskEntity, by: string | null): Promise<void> {
    const r = await this.endRun(t, 'cancelled');
    await this.log(t, by, `dừng run #${r.n}`);
  }

  /**
   * The runner reported an end: finish the run the way the mock's `finishRun` did. A run that
   * is already finalized (an engine-initiated cancel, a repeated event) is left alone.
   */
  async onAssignmentEnded(assignmentId: string): Promise<void> {
    const run = [...this.activeRuns.values()].find((r) => r.assignmentId === assignmentId);
    if (!run) return;
    const t = this.tasks.find((x) => x.id === run.taskId);
    const assignment = this.assignments.get(assignmentId);
    if (!t || !assignment) return;
    const agent = this.agent(assignment.agentId);
    const name = agent?.name ?? this.nameOf(assignment.agentId);
    const at = currentStep({ activeRun: this.activeView(t) });

    if (assignment.status === 'completed') {
      const r = await this.endRun(t, 'completed');
      t.subtasks = t.subtasks.map((s) => ({ ...s, done: true }));
      t.output ??= `Đã xong **${t.title.toLowerCase()}** trong ${r.durationSec}s, ${r.toolCalls} tool call. Chi tiết trong log run #${r.n}.`;
      t.status = statusAfterRun(t);
      await this.log(
        t,
        assignment.agentId,
        `xong run #${r.n}, chuyển sang **${STATUS_NAME[t.status]}**`,
      );
      this.notice(
        `**${name}** xong **${t.id}** → ${STATUS_NAME[t.status]}`,
        assignment.agentId,
        t.id,
      );
    } else if (assignment.status === 'failed') {
      const tool = at?.tool ?? 'tool';
      const r = await this.endRun(t, 'failed', assignment.error ?? `${tool} exit 1`);
      t.status = 'todo';
      t.error = `Run #${r.n} lỗi ở ${tool}`;
      await this.log(t, assignment.agentId, `run #${r.n} thất bại ở \`${tool}\``, 'error');
      this.notice(`**${name}** lỗi ở **${t.id}**, đã trả về Cần làm`, assignment.agentId, t.id);
    } else if (assignment.status === 'expired') {
      const r = await this.endRun(t, 'expired');
      t.status = 'todo';
      t.error = `Run #${r.n} hết hạn`;
      await this.log(t, assignment.agentId, `run #${r.n} hết hạn lease, trả lại hàng đợi`, 'error');
      this.notice(`**${name}** hết hạn ở **${t.id}**, đã trả về Cần làm`, assignment.agentId, t.id);
    } else if (assignment.status === 'cancelled') {
      // Cancelled outside the engine (e.g. an operator on the gateway).
      await this.cancelRun(t, null);
      t.status = 'todo';
    } else {
      return;
    }
    this.pickLater(assignment.agentId, PICK_AFTER_RUN_MS);
    this.changed();
  }

  /** The run's progress in the contract shape (for `currentStep`). */
  private activeView(t: TaskEntity): Task['activeRun'] {
    const run = this.activeRunOf(t);
    return run
      ? { n: run.n, startedAt: '', step: run.step, steps: run.steps, computerId: '' }
      : null;
  }

  /** An idle, online agent takes the highest-priority task from its queue. */
  async pickNext(agentId: string): Promise<void> {
    const agent = this.agent(agentId);
    if (
      !agent ||
      this.workspace.schedulerPaused ||
      !this.isOnline(agent) ||
      this.runningOf(agentId)
    )
      return;
    const [next] = pickableOf(this.view(), agentId);
    if (!next) return;
    const row = this.rowOf(next);
    await this.startRun(row);
    this.notice(`**${agent.name}** tự nhận **${row.id}** từ hàng đợi`, agent.id, row.id);
    this.changed();
  }

  /** Reconcile pass: every idle online agent looks at its queue. */
  async pickAll(): Promise<void> {
    for (const agent of this.agents) await this.pickNext(agent.id);
  }

  /**
   * Advances one running task by one tool step (a runner heartbeat of the simulator).
   * Only touches runs whose assignment the runner has accepted; after the last step it
   * reports the result through the gateway, and the `assignment.ended` listener finishes it.
   */
  async advance(taskId: string): Promise<void> {
    const t = this.tasks.find((x) => x.id === taskId);
    const run = t && this.activeRunOf(t);
    // A run without a script reports its own steps (real daemon): nothing to advance here.
    if (!t || !run || !run.steps.length) return;
    const assignment = await this.manager.findOneBy(Assignment, { id: run.assignmentId });
    if (!assignment || assignment.status !== 'running') return;
    this.assignments.set(assignment.id, assignment);

    run.step++;
    const n = run.steps.length;
    const due = subtasksDue(run.step, n, t.subtasks.length);
    t.subtasks = t.subtasks.map((s, i) => (i < due ? { ...s, done: true } : s));
    await this.manager.update(TaskRun, { id: run.id }, { step: run.step });
    await this.deps.gateway.progress(
      assignment.id,
      assignment.attempt,
      [{ kind: 'tool', payload: run.steps[Math.min(run.step, n) - 1] }],
      this.tx,
    );
    if (run.step >= n) {
      const at = currentStep({ activeRun: this.activeView(t) })!;
      await this.deps.gateway.result(
        assignment.id,
        assignment.attempt,
        this.deps.random() < TASK_FAIL_RATE
          ? { status: 'failed', error: `${at.tool} exit 1` }
          : { status: 'completed' },
        this.tx,
      );
    }
    this.changed();
  }

  /**
   * Progress of a real daemon on a running task: every new tool call becomes a step of the
   * run (`step` = steps so far), turns are recorded on the assignment. Calls are told apart by
   * id, so the later "ok"/"error" report of a call only updates its log entry.
   */
  async recordProgress(
    assignmentId: string,
    attempt: number,
    events: DaemonProgress[],
  ): Promise<void> {
    const run = [...this.activeRuns.values()].find((r) => r.assignmentId === assignmentId);
    const assignment = this.assignments.get(assignmentId);
    if (!run || !assignment) return;
    const known = new Set(assignment.toolLog.map((call) => call.id));
    const steps = [...run.steps];
    const payloads: Array<{ kind: 'tool' | 'step'; payload: unknown }> = [];
    for (const event of events) {
      if (event.kind === 'turns') {
        payloads.push({ kind: 'step', payload: { turns: event.turns } });
        continue;
      }
      const call = event.call;
      if (!known.has(call.id) && steps.length < MAX_RUN_STEPS) {
        steps.push({
          tool: call.name.slice(0, MAX_STEP_TOOL_CHARS),
          input: call.input.slice(0, MAX_STEP_INPUT_CHARS),
        });
      }
      known.add(call.id);
      payloads.push({ kind: 'tool', payload: call });
    }
    if (!payloads.length) return;
    this.assignments.set(
      assignmentId,
      await this.deps.gateway.progress(assignmentId, attempt, payloads, this.tx),
    );
    if (steps.length !== run.steps.length) {
      run.steps = steps;
      run.step = steps.length;
      await this.manager.update(TaskRun, { id: run.id }, { step: run.step, steps: run.steps });
    }
    this.changed();
  }

  /**
   * One simulator step: a random running task of `computerIds` (any computer when omitted)
   * advances. Nothing moves while the scheduler is paused.
   */
  async tick(computerIds?: ReadonlySet<string>): Promise<void> {
    if (this.workspace.schedulerPaused) return;
    const running = this.tasks.filter((t) => {
      const run = this.activeRunOf(t);
      const assignment = run && this.assignments.get(run.assignmentId);
      return (
        assignment?.status === 'running' &&
        this.agent(t.assigneeAgentId) &&
        (!computerIds || computerIds.has(assignment.computerId))
      );
    });
    if (!running.length) return;
    await this.advance(running[Math.floor(this.deps.random() * running.length)].id);
  }

  // ---------- commands ----------
  async moveTask(t: TaskEntity, to: TaskStatus, by: string | null = this.by): Promise<void> {
    if (t.status === to && !(to === 'doing' && !this.activeRunOf(t))) return;
    if (t.status === 'done') this.dropDeletedAssignee(t);
    const agent = this.agent(t.assigneeAgentId);
    const wasRunning = !!this.activeRunOf(t);
    if (wasRunning && to !== 'doing') await this.cancelRun(t, by);
    if (to === 'doing' && agent) {
      const pc = agent.computer;
      if (pc.status !== 'online') {
        t.status = 'todo';
        t.blockedReason = `${pc.name} offline`;
        await this.log(t, by, `giữ ở **Cần làm**: ${pc.name} offline`);
        this.notice(
          `**${agent.name}** đang offline (${pc.name}). **${t.id}** được giữ ở Cần làm.`,
          agent.id,
          t.id,
        );
        return;
      }
      const busy = this.runningOf(agent.id);
      if (busy && busy !== t) {
        t.status = 'todo';
        await this.log(t, by, `xếp vào hàng đợi của ${agent.name}`);
        this.notice(
          `**${agent.name}** đang làm **${busy.id}**. Đã xếp **${t.id}** vào hàng đợi.`,
          agent.id,
          t.id,
        );
        return;
      }
      if (!this.activeRunOf(t)) await this.startRun(t);
      this.notice(`Đã giao **${t.id}** cho **${agent.name}**, đang chạy`, agent.id, t.id);
    } else {
      t.status = to;
      if (to === 'done') t.subtasks = t.subtasks.map((s) => ({ ...s, done: true }));
      await this.log(t, by, `chuyển sang **${STATUS_NAME[to]}**`);
      if (to === 'todo' && agent) this.pickLater(agent.id, PICK_AFTER_TODO_MS);
    }
    if (wasRunning && agent) this.pickLater(agent.id, PICK_AFTER_FREE_MS);
  }

  /**
   * Reorder: place `t` before `beforeId` (or at the end). Ranks that change are written with one
   * statement (not a row at a time) and recorded in the snapshots so `flush` skips them.
   */
  async rerank(t: TaskEntity, beforeId: string | null | undefined): Promise<void> {
    const changed: { id: string; rank: number }[] = [];
    placeBefore(this.tasks, t, beforeId).forEach((x, k) => {
      if (x.rank === k) return;
      x.rank = k;
      changed.push({ id: x.id, rank: k });
    });
    if (!changed.length) return;
    const values = changed.map((_, i) => `($${i * 2 + 2}::varchar, $${i * 2 + 3}::int)`).join(', ');
    await this.manager.query(
      `UPDATE tasks SET rank = v.rank FROM (VALUES ${values}) AS v(id, rank)
       WHERE tasks.workspace_id = $1 AND tasks.id = v.id`,
      [this.workspaceId, ...changed.flatMap((c) => [c.id, c.rank])],
    );
    for (const { id, rank } of changed) {
      const snapshot = this.snapshots.get(id);
      if (snapshot) snapshot.rank = JSON.stringify(rank);
    }
  }

  async createTask(input: CreateTaskInput): Promise<TaskEntity> {
    const title = input.title?.trim();
    if (!title) throw new BadRequestException({ message: 'tasks.TITLE_REQUIRED' });
    const assigneeId = input.assigneeId || null;
    if (assigneeId && !this.agent(assigneeId) && !this.memberExists(assigneeId))
      throw new BadRequestException({ message: 'tasks.UNKNOWN_ASSIGNEE' });
    const agent = this.agent(assigneeId);
    const status = input.status ?? 'todo';

    const chatId = agent ? await this.dmWith(agent) : null;
    const seq = returnedRows<{ task_seq: number }>(
      await this.manager.query(
        `UPDATE workspaces SET task_seq = task_seq + 1 WHERE id = $1 RETURNING task_seq`,
        [this.workspaceId],
      ),
    );
    const t = await this.manager.save(
      this.manager.create(TaskEntity, {
        workspaceId: this.workspaceId,
        id: `AG-${seq[0].task_seq}`,
        title,
        description: input.description?.trim() ?? '',
        status: status === 'doing' ? 'todo' : status,
        assigneeAgentId: agent?.id ?? null,
        assigneeMemberId: assigneeId && !agent ? assigneeId : null,
        priority: input.priority ?? 'med',
        labels: [inferLabel(title)],
        chatId,
        requiresReview: input.requiresReview ?? true,
        subtasks: [],
        output: null,
        blockedReason: null,
        error: null,
        createdByMemberId: this.by,
        rank: firstRank(this.tasks),
        createdAt: this.now(),
      }),
    );
    await this.log(t, this.by, 'tạo task');
    this.tasks.push(t);
    this.snapshots.set(t.id, snapshotOf(t));

    if (status === 'doing') await this.moveTask(t, 'doing');
    else if (status === 'todo' && agent) {
      if (!this.runningOf(agent.id) && this.isOnline(agent))
        this.pickLater(agent.id, PICK_AFTER_TODO_MS);
      else this.notice(`Đã thêm **${t.id}** vào hàng đợi của **${agent.name}**`, agent.id, t.id);
    }
    this.changed();
    return t;
  }

  /** A task that kept a since-deleted agent as assignee (finished work) becomes unassigned. */
  private dropDeletedAssignee(t: TaskEntity): void {
    if (t.assigneeAgentId && !this.agent(t.assigneeAgentId)) t.assigneeAgentId = null;
  }

  async updateTask(t: TaskEntity, patch: UpdateTaskInput): Promise<void> {
    const me = this.by;
    this.dropDeletedAssignee(t);
    if (patch.assigneeId !== undefined && patch.assigneeId !== assigneeIdOf(t)) {
      const to = patch.assigneeId || null;
      if (to && !this.agent(to) && !this.memberExists(to))
        throw new BadRequestException({ message: 'tasks.UNKNOWN_ASSIGNEE' });
      if (this.activeRunOf(t)) await this.cancelRun(t, me);
      const prev = t.assigneeAgentId;
      this.setAssignee(t, to);
      const assignedAgent = this.agent(to);
      if (assignedAgent && !t.chatId) t.chatId = await this.dmWith(assignedAgent);
      t.blockedReason = null;
      t.error = null;
      await this.log(t, me, to ? `giao cho **${this.nameOf(to)}**` : 'bỏ giao');
      if (to && this.agent(to) && (t.status === 'doing' || t.status === 'todo')) {
        t.status = 'todo';
        await this.moveTask(t, 'doing');
      }
      if (prev && this.agent(prev)) this.pickLater(prev, PICK_AFTER_FREE_MS);
    }
    if (patch.priority && patch.priority !== t.priority) {
      t.priority = patch.priority;
      await this.log(t, me, `đổi ưu tiên thành **${PRIORITY_NAME[t.priority]}**`);
    }
    if (patch.requiresReview !== undefined) t.requiresReview = patch.requiresReview;
    if (patch.subtasks)
      t.subtasks = patch.subtasks.map((s) => ({ title: s.title, done: !!s.done }));
    this.changed();
  }

  async stopTask(t: TaskEntity): Promise<void> {
    if (!this.activeRunOf(t)) throw notRunning();
    const agentId = t.assigneeAgentId;
    await this.cancelRun(t, this.by);
    t.status = 'todo';
    t.blockedReason = null;
    t.error = 'Đã dừng thủ công';
    if (agentId) this.pickLater(agentId, PICK_AFTER_FREE_MS);
    this.changed();
  }

  async retryTask(t: TaskEntity): Promise<void> {
    t.error = null;
    await this.moveTask(t, 'doing');
    this.changed();
  }

  /** Jump the queue: run now if the agent is free, otherwise go first in line as urgent. */
  async runNow(t: TaskEntity): Promise<void> {
    const agent = this.agent(t.assigneeAgentId);
    if (!agent) throw noAgent();
    const busy = this.runningOf(agent.id);
    if (busy && busy !== t) {
      t.rank = firstRank(this.tasks);
      t.priority = 'urgent';
      t.error = null;
      await this.log(t, this.by, 'đưa lên đầu hàng đợi (ưu tiên **Khẩn**)');
      this.notice(
        `**${t.id}** lên đầu hàng đợi, ${agent.name} sẽ làm ngay sau **${busy.id}**`,
        agent.id,
        t.id,
      );
    } else {
      t.error = null;
      await this.moveTask(t, 'doing');
    }
    this.changed();
  }

  async approveTask(t: TaskEntity): Promise<void> {
    if (t.status !== 'review') throw new ConflictException({ message: 'tasks.NOT_IN_REVIEW' });
    t.status = 'done';
    await this.log(t, this.by, 'duyệt kết quả, chuyển sang **Xong**');
    this.notice(`Đã duyệt **${t.id}**`, t.assigneeAgentId, null);
    const payload: TaskApprovedPayload = {
      workspaceId: this.workspaceId,
      taskId: t.id,
      title: t.title,
      agentId: t.assigneeAgentId,
      by: this.by,
    };
    this.emit(TASK_APPROVED_EVENT, payload);
    this.changed();
  }

  async reviseTask(t: TaskEntity, note?: string): Promise<void> {
    if (note?.trim()) await this.log(t, this.by, note.trim(), 'normal', 'comment');
    await this.log(t, this.by, 'yêu cầu sửa');
    t.status = 'todo';
    t.output = null;
    if (this.agent(t.assigneeAgentId)) await this.moveTask(t, 'doing');
    this.changed();
  }

  async comment(t: TaskEntity, markdown: string): Promise<void> {
    const text = markdown.trim();
    if (!text) throw new BadRequestException({ message: 'tasks.COMMENT_EMPTY' });
    await this.log(t, this.by, text, 'normal', 'comment');
    const mentioned = this.agents.find(
      (a) =>
        text.includes('@' + a.name) || (a.id === t.assigneeAgentId && /@agent|@claude/i.test(text)),
    );
    if (mentioned) {
      this.later(MENTION_REPLY_MS, async (cmd) => {
        await cmd.reply(t.id, mentioned.id);
      });
    }
    this.changed();
  }

  /** The mentioned agent's canned acknowledgement (a timer callback). */
  async reply(taskId: string, agentId: string): Promise<void> {
    const t = this.tasks.find((x) => x.id === taskId);
    if (!t) return;
    await this.log(t, agentId, 'Đã nhận, em sẽ cập nhật trong run tiếp theo.', 'normal', 'comment');
    this.changed();
  }

  /**
   * Soft-deletes an agent and releases everything it held: its active run is cancelled, its
   * open tasks are unassigned (a `doing` task goes back to `todo`), its open chat replies are
   * cancelled (their messages fail through the `assignment.ended` listener), and connections
   * pointing at it lose their agent. Finished work keeps its agent id.
   */
  async removeAgent(agentId: string): Promise<void> {
    const agent = this.agent(agentId);
    if (!agent) throw new NotFoundException({ message: 'agents.NOT_FOUND' });
    for (const t of this.tasks) {
      if (t.assigneeAgentId !== agentId || t.status === 'done') continue;
      if (this.activeRunOf(t)) await this.cancelRun(t, this.by);
      t.assigneeAgentId = null;
      if (t.status === 'doing') t.status = 'todo';
      await this.log(t, this.by, `bỏ giao: agent **${agent.name}** đã bị xoá`);
    }
    const open = await this.manager.find(Assignment, {
      where: { agentId, status: Not(In([...TERMINAL_STATUSES])) },
    });
    for (const assignment of open) {
      try {
        await this.deps.gateway.cancel(assignment.id, this.tx);
      } catch (error) {
        if (!isInvalidTransition(error)) throw error;
      }
    }
    const connections = await this.manager.findBy(WorkspaceConnection, {
      workspaceId: this.workspaceId,
      agentId,
    });
    for (const connection of connections) {
      if (connection.status === 'on') await turnConnectionOff(this.manager, connection);
      connection.agentId = null;
      await this.manager.save(connection);
    }
    if (connections.length) this.publish({ type: 'connections.changed' });
    await this.manager.softDelete(Agent, { id: agentId, workspaceId: this.workspaceId });
    this.agents = this.agents.filter((a) => a.id !== agentId);
    this.publish({ type: 'rooms.changed' });
    this.changed();
  }

  async setPaused(paused: boolean): Promise<void> {
    this.workspace.schedulerPaused = paused;
    await this.manager.update(Workspace, { id: this.workspaceId }, { schedulerPaused: paused });
    if (!paused) await this.pickAll();
    this.changed();
  }
}
