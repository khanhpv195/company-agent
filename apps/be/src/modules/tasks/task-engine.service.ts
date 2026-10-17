import { Injectable, Logger, NotFoundException, OnModuleDestroy } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import type { CreateTaskInput, MoveTaskInput, UpdateTaskInput } from '@repo/shared';
import type { EntityManager } from 'typeorm';
import { ClockService } from '../../common/clock';
import { EventsService } from '../events';
import { ASSIGNMENT_ENDED_EVENT, type AssignmentEndedPayload } from '../events/events.service';
import { AgentGatewayService, type Effect } from '../gateway/agent-gateway.service';
import { TaskCommand, type CommandDeps, type DaemonProgress, type Via } from './task-command';
import { Random, TaskTimers } from './task-timers';
import { WorkspaceGoneException, WorkspaceLockService } from './workspace-lock.service';

const CHANGED_COALESCE_MS = 1000;

/**
 * The task rules of the product (one run per agent, priority queues, auto pick-up, offline
 * computers block work, review before done), as commands. Every command runs under the
 * workspace lock in one transaction; events and timers fire after its commit. Runs go through
 * the agent gateway, whose `assignment.ended` events finish them (see `onAssignmentEnded`).
 */
@Injectable()
export class TaskEngineService implements OnModuleDestroy {
  private readonly logger = new Logger(TaskEngineService.name);
  private readonly deps: CommandDeps;
  /** Per workspace: a cooldown timer, and whether a ping arrived during it. */
  private readonly cooldown = new Map<string, { timer: NodeJS.Timeout; pending: boolean }>();

  constructor(
    private readonly lock: WorkspaceLockService,
    clock: ClockService,
    gateway: AgentGatewayService,
    events: EventsService,
    emitter: EventEmitter2,
    random: Random,
    private readonly timers: TaskTimers,
  ) {
    this.deps = {
      clock,
      gateway,
      events,
      emitter,
      random: () => random.next(),
      coalesceChanged: (workspaceId) => this.coalesceChanged(workspaceId),
      schedule: (workspaceId, ms, run) =>
        this.timers.later(ms, () => {
          this.exec(workspaceId, null, run).catch((error: unknown) =>
            this.logger.error(
              `Deferred task command failed in workspace ${workspaceId}`,
              error instanceof Error ? error.stack : String(error),
            ),
          );
        }),
    };
  }

  onModuleDestroy(): void {
    for (const { timer } of this.cooldown.values()) clearTimeout(timer);
    this.cooldown.clear();
  }

  /** Leading + trailing throttle: at most one ping per second and workspace. */
  private coalesceChanged(workspaceId: string): void {
    const entry = this.cooldown.get(workspaceId);
    if (entry) {
      entry.pending = true;
      return;
    }
    this.pingChanged(workspaceId);
    const timer = setTimeout(() => {
      const current = this.cooldown.get(workspaceId);
      this.cooldown.delete(workspaceId);
      if (current?.pending) this.coalesceChanged(workspaceId);
    }, CHANGED_COALESCE_MS);
    timer.unref();
    this.cooldown.set(workspaceId, { timer, pending: false });
  }

  private pingChanged(workspaceId: string): void {
    this.deps.events.publish(workspaceId, { type: 'tasks.changed' });
    this.deps.events.publish(workspaceId, { type: 'agents.changed' });
  }

  /** Resolves when every queued command (timers included) has finished. Used by tests. */
  settled(): Promise<void> {
    return this.lock.idle();
  }

  private exec<T>(
    workspaceId: string,
    by: string | null,
    fn: (cmd: TaskCommand) => Promise<T>,
    options: { skipDone?: boolean; coalesce?: boolean; via?: Via } = {},
  ): Promise<T> {
    return this.quietWhenGone(workspaceId, by, () => this.execLocked(workspaceId, by, fn, options));
  }

  /** Timers and listeners (no acting member) skip a deleted workspace; HTTP callers get the 404. */
  private async quietWhenGone<T>(
    workspaceId: string,
    by: string | null,
    run: () => Promise<T>,
  ): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (by === null && error instanceof WorkspaceGoneException) {
        this.logger.debug(`Workspace ${workspaceId} is gone; system command skipped`);
        return undefined as T;
      }
      throw error;
    }
  }

  private execLocked<T>(
    workspaceId: string,
    by: string | null,
    fn: (cmd: TaskCommand) => Promise<T>,
    options: { skipDone?: boolean; coalesce?: boolean; via?: Via },
  ): Promise<T> {
    return this.lock.run(workspaceId, async (manager, effects) => {
      const cmd = new TaskCommand(this.deps, manager, effects, workspaceId, by);
      cmd.coalesceChanges = options.coalesce ?? false;
      cmd.via = options.via ?? null;
      await cmd.load({ skipDone: options.skipDone });
      const result = await fn(cmd);
      await cmd.flush();
      return result;
    });
  }

  /** Returns the new task's id. */
  createTask(
    workspaceId: string,
    by: string | null,
    input: CreateTaskInput,
    via?: Via,
  ): Promise<string> {
    return this.exec(workspaceId, by, async (cmd) => (await cmd.createTask(input)).id, { via });
  }

  updateTask(
    workspaceId: string,
    by: string | null,
    id: string,
    patch: UpdateTaskInput,
    via?: Via,
  ) {
    return this.exec(workspaceId, by, (cmd) => cmd.updateTask(cmd.task(id), patch), { via });
  }

  moveTask(workspaceId: string, by: string | null, id: string, input: MoveTaskInput, via?: Via) {
    return this.exec(
      workspaceId,
      by,
      async (cmd) => {
        const t = cmd.task(id);
        if (input.beforeId !== undefined) await cmd.rerank(t, input.beforeId);
        await cmd.moveTask(t, input.status);
        cmd.changed();
      },
      { via },
    );
  }

  approveTask(workspaceId: string, by: string | null, id: string) {
    return this.exec(workspaceId, by, (cmd) => cmd.approveTask(cmd.task(id)));
  }

  reviseTask(workspaceId: string, by: string | null, id: string, note?: string) {
    return this.exec(workspaceId, by, (cmd) => cmd.reviseTask(cmd.task(id), note));
  }

  stopTask(workspaceId: string, by: string | null, id: string) {
    return this.exec(workspaceId, by, (cmd) => cmd.stopTask(cmd.task(id)));
  }

  retryTask(workspaceId: string, by: string | null, id: string) {
    return this.exec(workspaceId, by, (cmd) => cmd.retryTask(cmd.task(id)));
  }

  /**
   * Retry after the dashboard resolved an attention item: `within` runs first on the same
   * transaction (it marks the item resolved), then the task's error is cleared and it is moved
   * to `doing` by the normal engine rules (starts, queues or blocks). A task that no longer
   * exists is skipped; the item is resolved all the same. When `within` returns `false` the
   * retry is skipped (the item had already been resolved by someone else).
   */
  restartForAttention(
    workspaceId: string,
    by: string | null,
    taskId: string,
    within: (manager: EntityManager, effects: Effect[]) => Promise<boolean | void>,
  ): Promise<void> {
    return this.lock.run(workspaceId, async (manager, effects) => {
      const cmd = new TaskCommand(this.deps, manager, effects, workspaceId, by);
      await cmd.load();
      if ((await within(manager, effects)) === false) return;
      try {
        await cmd.retryTask(cmd.task(taskId));
      } catch (error) {
        if (!(error instanceof NotFoundException)) throw error;
      }
      await cmd.flush();
    });
  }

  /** Soft-deletes an agent under the workspace lock; see `TaskCommand.removeAgent`. */
  deleteAgent(workspaceId: string, by: string | null, agentId: string) {
    return this.exec(workspaceId, by, (cmd) => cmd.removeAgent(agentId));
  }

  runNow(workspaceId: string, by: string | null, id: string) {
    return this.exec(workspaceId, by, (cmd) => cmd.runNow(cmd.task(id)));
  }

  comment(workspaceId: string, by: string | null, id: string, markdown: string, via?: Via) {
    return this.exec(workspaceId, by, (cmd) => cmd.comment(cmd.task(id), markdown ?? ''), {
      via,
    });
  }

  setPaused(workspaceId: string, by: string | null, paused: boolean) {
    return this.exec(workspaceId, by, (cmd) => cmd.setPaused(paused));
  }

  pickNext(workspaceId: string, agentId: string) {
    return this.exec(workspaceId, null, (cmd) => cmd.pickNext(agentId), {
      skipDone: true,
    });
  }

  /** Every idle online agent of the workspace looks at its queue (the reconcile pass). */
  pickAll(workspaceId: string) {
    return this.exec(workspaceId, null, (cmd) => cmd.pickAll(), { skipDone: true });
  }

  /** One tool step of a running task (the runner's heartbeat). */
  advance(workspaceId: string, taskId: string) {
    return this.exec(workspaceId, null, (cmd) => cmd.advance(taskId), {
      skipDone: true,
      coalesce: true,
    });
  }

  /** Tool calls and turns a real daemon reports for a running task (throttled change pings). */
  recordProgress(
    workspaceId: string,
    assignmentId: string,
    attempt: number,
    events: DaemonProgress[],
  ) {
    return this.exec(
      workspaceId,
      null,
      (cmd) => cmd.recordProgress(assignmentId, attempt, events),
      { skipDone: true, coalesce: true },
    );
  }

  /** One simulator step: a random running task (of `computerIds`) advances. */
  tick(workspaceId: string, computerIds?: ReadonlySet<string>) {
    return this.exec(workspaceId, null, (cmd) => cmd.tick(computerIds), {
      skipDone: true,
      coalesce: true,
    });
  }

  /**
   * The runner's report ends the run: completed / failed / expired assignments finish their
   * task run here. Idempotent: an already finalized run (an engine-initiated cancel, a
   * repeated event) is a no-op.
   */
  @OnEvent(ASSIGNMENT_ENDED_EVENT)
  async onAssignmentEnded(payload: AssignmentEndedPayload): Promise<void> {
    if (payload.sourceKind !== 'task') return;
    try {
      await this.finishRun(payload.workspaceId, payload.assignmentId);
    } catch (error) {
      this.logger.error(
        `Finishing the run of assignment ${payload.assignmentId} failed`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /**
   * Finishes the task run of an ended assignment (no-op when none is active). Shared by the
   * `assignment.ended` listener and the reconcile repair scan.
   *
   * Race note (benign): `stopTask` cancels the assignment itself while the daemon may report
   * `completed` at the same moment. Whichever commits first wins; the loser finds the run
   * finalized (or the assignment terminal) and is a no-op, so the task never ends up half-done.
   */
  finishRun(workspaceId: string, assignmentId: string): Promise<void> {
    return this.exec(workspaceId, null, (cmd) => cmd.onAssignmentEnded(assignmentId), {
      skipDone: true,
    });
  }
}
