import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { ClockService } from '../../common/clock';
import { returnedRows } from '../../common/utils';
import { AuditService } from '../audit/audit.service';
import type { Member } from '../workspace/entities/member.entity';

/** Consecutive wrong passwords that lock the account, and for how long. */
export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_MS = 15 * 60_000;

/**
 * The wrong-password counter and lockout shared by login and the routes that ask for the
 * current password (`/me/password`, `DELETE /me`).
 */
@Injectable()
export class LoginAttemptService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly clock: ClockService,
    private readonly audit: AuditService,
  ) {}

  isLocked(member: Pick<Member, 'lockedUntil'>): boolean {
    return !!member.lockedUntil && member.lockedUntil.getTime() > this.clock.now().getTime();
  }

  lockedError(): HttpException {
    return new HttpException({ message: 'auth.ACCOUNT_LOCKED' }, HttpStatus.TOO_MANY_REQUESTS);
  }

  /**
   * Counts a wrong password; the failure that reaches the limit locks the account. The member
   * row is locked for the read-modify-write and `locked_until` is re-checked inside it, so
   * parallel failures count exactly once each and a lock that was just set is not extended.
   */
  async recordFailure(
    member: Pick<Member, 'id' | 'workspaceId'>,
    ip: string | null | undefined,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const [row] = returnedRows<{ failed_login_count: number; locked_until: Date | null }>(
        await manager.query(
          'SELECT failed_login_count, locked_until FROM members WHERE id = $1 FOR UPDATE',
          [member.id],
        ),
      );
      if (!row || this.isLocked({ lockedUntil: row.locked_until })) return;
      const base = { workspaceId: member.workspaceId, actorMemberId: member.id, ip };
      await this.audit.record({ ...base, action: 'auth.login_failed' }, manager);
      const count = row.failed_login_count + 1;
      if (count < MAX_FAILED_LOGINS) {
        await manager.query('UPDATE members SET failed_login_count = $2 WHERE id = $1', [
          member.id,
          count,
        ]);
        return;
      }
      const lockedUntil = new Date(this.clock.now().getTime() + LOCKOUT_MS);
      await manager.query(
        'UPDATE members SET failed_login_count = 0, locked_until = $2 WHERE id = $1',
        [member.id, lockedUntil],
      );
      await this.audit.record(
        { ...base, action: 'auth.locked', meta: { lockedUntil: lockedUntil.toISOString() } },
        manager,
      );
    });
  }

  /** After a correct password: clears the counter and any expired lock (no-op when clean). */
  async reset(
    manager: EntityManager,
    member: Pick<Member, 'id' | 'failedLoginCount' | 'lockedUntil'>,
  ): Promise<void> {
    if (member.failedLoginCount === 0 && !member.lockedUntil) return;
    await manager.query(
      'UPDATE members SET failed_login_count = 0, locked_until = NULL WHERE id = $1',
      [member.id],
    );
  }
}
