import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { EntityManager } from 'typeorm';
import { ClockService } from '../../common/clock';
import { returnedRows } from '../../common/utils';
import { AccountToken, AccountTokenKind } from '../account/entities/account-token.entity';
import { hashToken } from './token.service';

const HOUR_MS = 3_600_000;
export const ACCOUNT_TOKEN_TTL_MS: Record<AccountTokenKind, number> = {
  reset_password: HOUR_MS,
  verify_email: 7 * 24 * HOUR_MS,
};

/** Single-use emailed tokens (password reset, email verification). */
@Injectable()
export class AccountTokenService {
  constructor(private readonly clock: ClockService) {}

  /** Marks the member's unused tokens of `kind` as used. */
  async invalidate(
    manager: EntityManager,
    memberId: string,
    kind: AccountTokenKind,
  ): Promise<void> {
    await manager
      .createQueryBuilder()
      .update(AccountToken)
      .set({ usedAt: this.clock.now() })
      .where('member_id = :memberId AND kind = :kind AND used_at IS NULL', { memberId, kind })
      .execute();
  }

  /** Creates a token and invalidates the member's older unused ones of the same kind. */
  async issue(manager: EntityManager, memberId: string, kind: AccountTokenKind): Promise<string> {
    const now = this.clock.now();
    await this.invalidate(manager, memberId, kind);
    const token = randomBytes(32).toString('base64url');
    await manager.insert(AccountToken, {
      memberId,
      kind,
      tokenHash: hashToken(token),
      expiresAt: new Date(now.getTime() + ACCOUNT_TOKEN_TTL_MS[kind]),
      usedAt: null,
      // From the clock, not the database default, so the resend limit follows the same time as expiry.
      createdAt: now,
    });
    return token;
  }

  /**
   * Marks the token used and returns its member, or `null` when it is unknown, expired or
   * already used. One conditional UPDATE, so two parallel redemptions cannot both win.
   */
  async consume(
    manager: EntityManager,
    rawToken: string,
    kind: AccountTokenKind,
  ): Promise<string | null> {
    const rows = returnedRows<{ member_id: string }>(
      await manager.query(
        `UPDATE account_tokens SET used_at = $3
         WHERE token_hash = $1 AND kind = $2 AND used_at IS NULL AND expires_at > $3
         RETURNING member_id`,
        [hashToken(rawToken), kind, this.clock.now()],
      ),
    );
    return rows[0]?.member_id ?? null;
  }

  /** When the member's latest token of `kind` was issued, for the resend limit. */
  async lastIssuedAt(manager: EntityManager, memberId: string, kind: AccountTokenKind) {
    const latest = await manager.findOne(AccountToken, {
      where: { memberId, kind },
      order: { createdAt: 'DESC' },
      select: { createdAt: true },
    });
    return latest?.createdAt ?? null;
  }
}
