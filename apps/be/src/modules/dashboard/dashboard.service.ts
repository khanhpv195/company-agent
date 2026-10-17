import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectDataSource } from '@nestjs/typeorm';
import type { AttentionItem, DashboardSummary, FeedItem } from '@repo/shared';
import { isUUID } from 'class-validator';
import { DataSource, EntityManager, IsNull } from 'typeorm';
import { ClockService } from '../../common/clock';
import type { AuthContext } from '../../common/types';
import { returnedRows } from '../../common/utils';
import {
  DASHBOARD_DAYS,
  DASHBOARD_FEED_LIMIT,
  FEED_KEEP,
  WORKSPACE_TIMEZONE,
} from '../../contacts';
import { Agent } from '../agents/entities/agent.entity';
import { CHAT_RUN_ENDED_EVENT, type ChatRunEndedPayload } from '../chat/chat.constants';
import {
  COMPUTER_OFFLINE_EVENT,
  COMPUTER_ONLINE_EVENT,
  type ComputerStatusPayload,
} from '../computers/computer-events';
import { EventsService } from '../events';
import type { Effect } from '../gateway/agent-gateway.service';
import {
  TASK_APPROVED_EVENT,
  TASK_RUN_ENDED_EVENT,
  type TaskApprovedPayload,
  type TaskRunEndedPayload,
} from '../tasks/task-events';
import { TaskEngineService } from '../tasks/task-engine.service';
import { WorkspaceLockService } from '../tasks/workspace-lock.service';
import { FINISHED_SQL } from './dashboard.sql';
import { lastDays, localDate } from './dashboard.util';
import { AttentionItemRow, attentionKey } from './entities/attention-item.entity';
import { FeedItemRow } from './entities/feed-item.entity';

interface NewAttention {
  kind: AttentionItem['kind'];
  title: string;
  meta: string;
  action: string;
  taskId: string | null;
  computerId: string | null;
}

interface FinishedRow {
  day: string;
  agent_id: string;
  ok: boolean;
  count: number;
  minutes: number;
}

const toAttention = (row: AttentionItemRow): AttentionItem => ({
  id: row.id,
  kind: row.kind,
  title: row.title,
  meta: row.meta,
  action: row.action,
  taskId: row.taskId,
  resolved: row.resolvedAt !== null,
});

const toFeed = (row: FeedItemRow): FeedItem => ({
  id: row.id,
  by: row.by,
  text: row.text,
  at: row.at.toISOString(),
});

/**
 * The dashboard: aggregates computed from the finished work (nothing is double counted in a
 * counter table), the activity feed and the "needs attention" list. The feed and the
 * attention list are written by the domain-event listeners below, each under the workspace
 * lock, publishing `dashboard.changed` after the commit.
 */
@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly lock: WorkspaceLockService,
    private readonly engine: TaskEngineService,
    private readonly clock: ClockService,
    private readonly events: EventsService,
  ) {}

  // ---------- reads ----------

  async summary(workspaceId: string): Promise<DashboardSummary> {
    const today = localDate(this.clock.now(), WORKSPACE_TIMEZONE);
    const dates = lastDays(today, DASHBOARD_DAYS);
    const manager = this.dataSource.manager;
    const [finished, attention, feed, liveAgents] = await Promise.all([
      manager.query(FINISHED_SQL, [workspaceId, WORKSPACE_TIMEZONE, dates[0], today]),
      manager.find(AttentionItemRow, {
        where: { workspaceId, resolvedAt: IsNull() },
        order: { createdAt: 'DESC', id: 'ASC' },
      }),
      manager.find(FeedItemRow, {
        where: { workspaceId },
        order: { at: 'DESC', id: 'ASC' },
        take: DASHBOARD_FEED_LIMIT,
      }),
      manager.find(Agent, { where: { workspaceId }, select: { id: true } }),
    ]);
    const liveAgentIds = new Set(liveAgents.map((agent) => agent.id));

    const days = new Map(dates.map((date) => [date, { date, completed: 0, failed: 0 }]));
    const byAgent = new Map<string, number>();
    let minutesToday = 0;
    for (const row of returnedRows<FinishedRow>(finished)) {
      const day = days.get(row.day);
      if (!day) continue;
      if (row.ok) day.completed += row.count;
      else day.failed += row.count;
      // Totals keep deleted agents' work; the per-agent breakdown lists live agents only.
      if (liveAgentIds.has(row.agent_id)) {
        byAgent.set(row.agent_id, (byAgent.get(row.agent_id) ?? 0) + row.count);
      }
      if (row.day === today) minutesToday += row.minutes;
    }
    return {
      days: [...days.values()],
      byAgent: [...byAgent]
        .map(([agentId, count]) => ({ agentId, count }))
        .sort((a, b) => b.count - a.count || a.agentId.localeCompare(b.agentId)),
      minutesToday,
      attention: attention.map(toAttention),
      feed: feed.map(toFeed),
    };
  }

  // ---------- commands ----------

  /**
   * Marks an item resolved. With a task, the task's error is cleared and it is moved to
   * `doing` by the engine (same lock and transaction), so it starts, queues or stays blocked
   * by the normal rules. Resolving an already resolved item changes nothing.
   */
  async resolve(auth: AuthContext, id: string): Promise<AttentionItem> {
    const { workspaceId, memberId } = auth;
    const find = () =>
      isUUID(id) ? this.dataSource.manager.findOneBy(AttentionItemRow, { id, workspaceId }) : null;
    const current = await find();
    if (!current) throw this.notFound();
    if (current.resolvedAt) return toAttention(current);

    // Runs under the workspace lock: re-read the row, someone may have resolved it since the
    // unlocked read above. `false` tells the engine to skip the retry.
    const markResolved = async (manager: EntityManager, effects: Effect[]): Promise<boolean> => {
      const locked = await manager.findOneBy(AttentionItemRow, { id, workspaceId });
      if (!locked || locked.resolvedAt) return false;
      await manager.update(AttentionItemRow, { id, workspaceId }, { resolvedAt: this.clock.now() });
      this.publishChanged(effects, workspaceId);
      return true;
    };
    if (current.taskId) {
      await this.engine.restartForAttention(workspaceId, memberId, current.taskId, markResolved);
    } else {
      await this.lock.run(workspaceId, async (manager, effects) => {
        await markResolved(manager, effects);
      });
    }
    const row = await find();
    if (!row) throw this.notFound();
    return toAttention(row);
  }

  private notFound(): NotFoundException {
    return new NotFoundException({ message: 'dashboard.NOT_FOUND' });
  }

  // ---------- writers (also used by the connections module) ----------

  /** Adds a feed line on the caller's transaction; the caller publishes nothing itself. */
  async recordFeed(
    manager: EntityManager,
    effects: Effect[],
    workspaceId: string,
    by: string,
    text: string,
  ): Promise<void> {
    await manager.insert(FeedItemRow, { workspaceId, by, text, at: this.clock.now() });
    await manager.query(
      `DELETE FROM feed_items WHERE workspace_id = $1 AND id NOT IN (
         SELECT id FROM feed_items WHERE workspace_id = $1 ORDER BY at DESC, id LIMIT $2)`,
      [workspaceId, FEED_KEEP],
    );
    this.publishChanged(effects, workspaceId);
  }

  /** Opens an item unless the same cause already has an open one. */
  private async openAttention(
    manager: EntityManager,
    effects: Effect[],
    workspaceId: string,
    item: NewAttention,
  ): Promise<void> {
    const result = await manager
      .createQueryBuilder()
      .insert()
      .into(AttentionItemRow)
      .values({
        workspaceId,
        ...item,
        dedupKey: attentionKey(item.kind, item.taskId, item.computerId),
        resolvedAt: null,
        createdAt: this.clock.now(),
      })
      .orIgnore()
      .returning('id')
      .execute();
    if (returnedRows(result.raw).length > 0) this.publishChanged(effects, workspaceId);
  }

  private async resolveOpen(
    manager: EntityManager,
    effects: Effect[],
    workspaceId: string,
    where: { kind: AttentionItem['kind']; taskId?: string; computerId?: string },
  ): Promise<void> {
    const column = where.taskId !== undefined ? 'task_id' : 'computer_id';
    const result = await manager.query(
      `UPDATE attention_items SET resolved_at = $1
       WHERE workspace_id = $2 AND kind = $3 AND ${column} = $4 AND resolved_at IS NULL
       RETURNING id`,
      [this.clock.now(), workspaceId, where.kind, where.taskId ?? where.computerId],
    );
    if (returnedRows(result).length > 0) this.publishChanged(effects, workspaceId);
  }

  private publishChanged(effects: Effect[], workspaceId: string): void {
    effects.push(() => this.events.publish(workspaceId, { type: 'dashboard.changed' }));
  }

  // ---------- domain event listeners ----------

  @OnEvent(TASK_RUN_ENDED_EVENT)
  onTaskRunEnded(payload: TaskRunEndedPayload): Promise<void> {
    return this.guarded('task run', () =>
      this.write(payload.workspaceId, async (manager, effects) => {
        const { workspaceId, taskId, title, agentId, status } = payload;
        if (status === 'completed') {
          await this.recordFeed(manager, effects, workspaceId, agentId, `xong **${title}**`);
          await this.resolveOpen(manager, effects, workspaceId, { kind: 'error', taskId });
        } else if (status === 'failed' || status === 'expired') {
          await this.recordFeed(manager, effects, workspaceId, agentId, `thất bại ở **${title}**`);
          const agent = await manager.findOne(Agent, { where: { id: agentId }, withDeleted: true });
          await this.openAttention(manager, effects, workspaceId, {
            kind: 'error',
            title: status === 'failed' ? `${title} thất bại` : `${title} hết hạn lease`,
            meta: `${agent?.name ?? 'Agent'} · ${taskId}`,
            action: 'Chạy lại',
            taskId,
            computerId: null,
          });
        }
      }),
    );
  }

  @OnEvent(TASK_APPROVED_EVENT)
  onTaskApproved(payload: TaskApprovedPayload): Promise<void> {
    if (!payload.by) return Promise.resolve();
    const by = payload.by;
    return this.guarded('task approval', () =>
      this.write(payload.workspaceId, (manager, effects) =>
        this.recordFeed(manager, effects, payload.workspaceId, by, `duyệt **${payload.title}**`),
      ),
    );
  }

  @OnEvent(CHAT_RUN_ENDED_EVENT)
  onChatRunEnded(payload: ChatRunEndedPayload): Promise<void> {
    return this.guarded('chat run', () =>
      this.write(payload.workspaceId, (manager, effects) =>
        this.recordFeed(
          manager,
          effects,
          payload.workspaceId,
          payload.agentId,
          payload.dm
            ? payload.ok
              ? 'trả lời trong DM'
              : 'thất bại khi trả lời trong DM'
            : payload.ok
              ? `trả lời **${payload.preview}**`
              : `thất bại khi trả lời **${payload.preview}**`,
        ),
      ),
    );
  }

  @OnEvent(COMPUTER_OFFLINE_EVENT)
  onComputerOffline(payload: ComputerStatusPayload): Promise<void> {
    return this.guarded('computer offline', () =>
      this.write(payload.workspaceId, async (manager, effects) => {
        const agents = await manager.find(Agent, {
          where: { workspaceId: payload.workspaceId, computerId: payload.computerId },
          order: { createdAt: 'ASC', id: 'ASC' },
        });
        await this.openAttention(manager, effects, payload.workspaceId, {
          kind: 'offline',
          title: `${payload.name} offline`,
          meta: agents.length
            ? `${agents.map((agent) => agent.name).join(', ')} không nhận được việc mới`
            : 'Không có agent nào nhận được việc mới',
          action: 'Hướng dẫn',
          taskId: null,
          computerId: payload.computerId,
        });
      }),
    );
  }

  @OnEvent(COMPUTER_ONLINE_EVENT)
  onComputerOnline(payload: ComputerStatusPayload): Promise<void> {
    return this.guarded('computer online', () =>
      this.write(payload.workspaceId, (manager, effects) =>
        this.resolveOpen(manager, effects, payload.workspaceId, {
          kind: 'offline',
          computerId: payload.computerId,
        }),
      ),
    );
  }

  private write(
    workspaceId: string,
    fn: (manager: EntityManager, effects: Effect[]) => Promise<void>,
  ): Promise<void> {
    return this.lock.run(workspaceId, fn);
  }

  /** Listeners are fire-and-forget: a failure is logged, never an unhandled rejection. */
  private async guarded(what: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (error) {
      this.logger.error(
        `Recording the dashboard entry for a ${what} failed`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
