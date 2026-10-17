import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { AuditEvent } from '@repo/shared';
import { DataSource, EntityManager } from 'typeorm';
import { ClockService } from '../../common/clock';
import { AuditCursor, encodeAuditCursor } from './audit-cursor';
import { AuditEventRow } from './entities/audit-event.entity';

/** Who did it: the member behind a request (or null) and where from. */
export interface AuditActor {
  memberId: string | null;
  ip?: string | null;
}

export interface AuditEntry {
  workspaceId: string;
  actorMemberId?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  meta?: Record<string, unknown>;
  ip?: string | null;
}

interface AuditQueryRow {
  id: string;
  created_at: Date;
  /** Same instant as text, microseconds kept: the cursor must not round it. */
  created_cursor: string;
  actor_member_id: string | null;
  actor_name: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  meta: Record<string, unknown>;
  ip: string | null;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly clock: ClockService,
  ) {}

  /**
   * Appends one event. Pass the caller's `manager` to write it in the same transaction as the
   * change (then a failure rolls both back); without one a failure is logged and swallowed, so
   * auditing never breaks a request that already succeeded.
   */
  async record(entry: AuditEntry, manager?: EntityManager): Promise<void> {
    const write = (m: EntityManager) =>
      m.insert(AuditEventRow, {
        workspaceId: entry.workspaceId,
        actorMemberId: entry.actorMemberId ?? null,
        action: entry.action,
        targetType: entry.targetType ?? null,
        targetId: entry.targetId ?? null,
        // jsonb: TypeORM's deep-partial insert type cannot express an arbitrary record.
        meta: (entry.meta ?? {}) as never,
        ip: entry.ip ?? null,
        createdAt: this.clock.now(),
      });
    if (manager) {
      await write(manager);
      return;
    }
    try {
      await write(this.dataSource.manager);
    } catch (error) {
      this.logger.error(
        `Failed to record audit event ${entry.action}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /**
   * Newest first, keyset-paged on `(created_at, id)`: events sharing a timestamp are never
   * skipped or repeated across pages, and there is no count query. Reads one extra row to
   * know whether `nextCursor` exists. The index `(workspace_id, created_at, id)` serves this
   * order with a backward scan.
   */
  async list(
    workspaceId: string,
    options: { before?: AuditCursor; limit: number },
  ): Promise<{ items: AuditEvent[]; nextCursor: string | null }> {
    const limit = Math.trunc(options.limit);
    const params: unknown[] = [workspaceId];
    let where = 'e.workspace_id = $1';
    if (options.before) {
      params.push(options.before.at, options.before.id);
      where += ` AND (e.created_at, e.id) < ($2::timestamptz, $3::uuid)`;
    }
    const rows = await this.dataSource.query<AuditQueryRow[]>(
      `SELECT e.id, e.created_at,
              to_char(e.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_cursor,
              e.actor_member_id, m.name AS actor_name, e.action,
              e.target_type, e.target_id, e.meta, e.ip
       FROM audit_events e
       LEFT JOIN members m ON m.id = e.actor_member_id
       WHERE ${where}
       ORDER BY e.created_at DESC, e.id DESC
       LIMIT ${limit + 1}`,
      params,
    );
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      nextCursor:
        rows.length > limit && last
          ? encodeAuditCursor({ at: last.created_cursor, id: last.id })
          : null,
      items: page.map((row) => ({
        id: row.id,
        at: row.created_at.toISOString(),
        actor:
          row.actor_member_id && row.actor_name !== null
            ? { id: row.actor_member_id, name: row.actor_name }
            : null,
        action: row.action,
        targetType: row.target_type,
        targetId: row.target_id,
        meta: row.meta,
        ip: row.ip,
      })),
    };
  }
}
