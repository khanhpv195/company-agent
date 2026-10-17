import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { AuthSessionInfo } from '@repo/shared';
import { DataSource, EntityManager } from 'typeorm';
import { ClockService } from '../../common/clock';
import { returnedRows } from '../../common/utils';
import { EventsService } from '../events';

interface SessionRow {
  family_id: string;
  created_at: Date;
  last_used_at: Date;
  user_agent: string | null;
  ip: string | null;
}

/** Live logins (refresh-token families) of a member: list, revoke one, revoke the rest. */
@Injectable()
export class SessionService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly clock: ClockService,
    private readonly events: EventsService,
  ) {}

  /** A family is live while it still has an unrevoked, unexpired token (the latest rotation). */
  async list(memberId: string, currentSessionId?: string): Promise<AuthSessionInfo[]> {
    const rows: SessionRow[] = await this.dataSource.query(
      `SELECT t.family_id,
              (SELECT min(f.created_at) FROM refresh_tokens f WHERE f.family_id = t.family_id) AS created_at,
              t.created_at AS last_used_at, t.user_agent, t.ip
       FROM refresh_tokens t
       WHERE t.member_id = $1 AND t.revoked_at IS NULL AND t.expires_at > $2
       ORDER BY t.created_at DESC, t.id DESC`,
      [memberId, this.clock.now()],
    );
    return rows.map((row) => ({
      id: row.family_id,
      createdAt: row.created_at.toISOString(),
      lastUsedAt: row.last_used_at.toISOString(),
      userAgent: row.user_agent,
      ip: row.ip,
      current: row.family_id === currentSessionId,
    }));
  }

  /**
   * Revokes one family of the member; false when they have no such live session. Runs in the
   * caller's transaction when given; close the streams after it commits (`closeSessionStreams`).
   */
  async revoke(memberId: string, sessionId: string, manager?: EntityManager): Promise<boolean> {
    const rows = returnedRows<{ id: string }>(
      await (manager ?? this.dataSource).query(
        `UPDATE refresh_tokens SET revoked_at = $3
         WHERE member_id = $1 AND family_id = $2 AND revoked_at IS NULL AND expires_at > $3
         RETURNING id`,
        [memberId, sessionId, this.clock.now()],
      ),
    );
    return rows.length > 0;
  }

  closeSessionStreams(memberId: string, sessionId: string): void {
    this.events.closeMemberStreams(memberId, { onlySessionId: sessionId });
  }

  /**
   * Revokes every live family of the member except `exceptSessionId`, inside the caller's
   * transaction when given. Returns how many sessions were revoked. Streams close after the
   * caller commits via `closeStreams`.
   */
  async revokeAll(
    memberId: string,
    options: { except?: string; manager?: EntityManager } = {},
  ): Promise<number> {
    const manager = options.manager ?? this.dataSource.manager;
    const rows = returnedRows<{ family_id: string }>(
      await manager.query(
        `UPDATE refresh_tokens SET revoked_at = $2
         WHERE member_id = $1 AND revoked_at IS NULL AND expires_at > $2
           AND ($3::uuid IS NULL OR family_id <> $3::uuid)
         RETURNING family_id`,
        [memberId, this.clock.now(), options.except ?? null],
      ),
    );
    return new Set(rows.map((row) => row.family_id)).size;
  }

  closeStreams(memberId: string, exceptSessionId?: string): void {
    this.events.closeMemberStreams(memberId, exceptSessionId ? { exceptSessionId } : {});
  }
}
