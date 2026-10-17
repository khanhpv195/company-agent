import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { returnedRows } from '../../common/utils';
import { agentConfig } from '../../config';
import { RECONCILE_INTERVAL_MS } from '../../contacts';
import { TERMINAL_STATUSES } from '../gateway/entities/assignment.entity';
import { TaskEngineService } from './task-engine.service';

/**
 * Periodic task housekeeping: repairs runs stranded by a lost `assignment.ended` event, then
 * lets every idle online agent of a running scheduler look at its queue, so a restart (lost
 * timers) or a computer coming back online never strands work.
 * Lives beside the gateway's lease reconcile (same interval, same switch).
 */
@Injectable()
export class TaskReconcileService {
  private readonly logger = new Logger(TaskReconcileService.name);
  private running = false;

  constructor(
    @Inject(agentConfig.KEY) private readonly config: ConfigType<typeof agentConfig>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly engine: TaskEngineService,
  ) {}

  @Interval(RECONCILE_INTERVAL_MS)
  async tick(): Promise<void> {
    if (!this.config.reconcileEnabled || this.running) return;
    this.running = true;
    try {
      // Repair first: a freed agent can then be picked up in the same pass.
      await this.step('repair', () => this.repairStranded());
      await this.step('pick', () => this.pickPass());
    } finally {
      this.running = false;
    }
  }

  /** Each step fails alone: one throwing must not skip the other. */
  private async step(name: string, run: () => Promise<void>): Promise<void> {
    try {
      await run();
    } catch (error) {
      this.logger.error(
        `Task reconcile step ${name} failed`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /**
   * Repair scan: an active task run (finalized_at IS NULL) whose assignment already ended
   * lost its `assignment.ended` event (a crash between commit and delivery). Finish it through
   * the idempotent engine path, one assignment at a time under its workspace lock.
   */
  async repairStranded(): Promise<void> {
    const rows = returnedRows<{ workspace_id: string; assignment_id: string }>(
      await this.dataSource.query(
        `SELECT r.workspace_id, r.assignment_id
         FROM task_runs r JOIN assignments a ON a.id = r.assignment_id
         WHERE r.finalized_at IS NULL AND a.status = ANY($1::text[])`,
        [[...TERMINAL_STATUSES]],
      ),
    );
    for (const row of rows) {
      try {
        await this.engine.finishRun(row.workspace_id, row.assignment_id);
      } catch (error) {
        this.logger.error(
          `Repairing the run of assignment ${row.assignment_id} failed`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }
  }

  /**
   * Pick-up pass over the workspaces that can actually start something: scheduler running,
   * and an idle agent (no active task assignment) on an online computer with a pickable todo.
   */
  async pickPass(): Promise<void> {
    const rows = returnedRows<{ workspace_id: string }>(
      await this.dataSource.query(
        `SELECT DISTINCT ag.workspace_id
         FROM agents ag
         JOIN workspaces w ON w.id = ag.workspace_id AND w.scheduler_paused = false
         JOIN computers c ON c.id = ag.computer_id AND c.status = 'online'
         WHERE NOT EXISTS (
             SELECT 1 FROM assignments a
             WHERE a.agent_id = ag.id AND a.source_kind = 'task'
               AND a.status IN ('offered', 'claimed', 'running'))
           AND EXISTS (
             SELECT 1 FROM tasks t
             WHERE t.workspace_id = ag.workspace_id AND t.assignee_agent_id = ag.id
               AND t.status = 'todo' AND t.blocked_reason IS NULL AND t.error IS NULL)`,
      ),
    );
    for (const { workspace_id: workspaceId } of rows) {
      try {
        await this.engine.pickAll(workspaceId);
      } catch (error) {
        this.logger.error(
          `Task pick-up failed in workspace ${workspaceId}`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }
  }
}
