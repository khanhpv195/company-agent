import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { createHash, randomInt } from 'node:crypto';
import { DataSource, QueryFailedError } from 'typeorm';
import { ClockService } from '../../common/clock';
import { returnedRows } from '../../common/utils';
import type { AuthContext } from '../../common/types';
import { hashApiKey, newApiKey } from '../computers/computers.service';
import { Computer } from '../computers/entities/computer.entity';
import { AuditService } from '../audit/audit.service';
import { PlanLimitsService } from '../billing/plan-limits.service';
import { EventsService } from '../events';
import { PairingCode } from '../gateway/entities/pairing-code.entity';
import { Workspace } from '../workspace/entities/workspace.entity';
import type { PairDto } from './dto/daemon.dto';

export const PAIRING_TTL_MS = 10 * 60 * 1000;
const CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;
const PG_UNIQUE_VIOLATION = '23505';
/** Active (unused, unexpired) codes a workspace may hold; creating one more voids the oldest. */
export const MAX_ACTIVE_CODES = 5;
/** Used or long expired codes are pruned past this age. */
const PRUNE_AFTER_MS = 24 * 60 * 60 * 1000;

/** `ABCD-EFGH` in any case, with or without the dash or spaces, hashes the same. */
const normalizeCode = (code: string): string => code.toUpperCase().replace(/[^A-Z0-9]/g, '');
const hashCode = (code: string): string =>
  createHash('sha256').update(normalizeCode(code)).digest('hex');

const generateCode = (): string => {
  let raw = '';
  for (let i = 0; i < CODE_LENGTH; i++) raw += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
};

@Injectable()
export class PairingService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly clock: ClockService,
    private readonly events: EventsService,
    private readonly audit: AuditService,
    private readonly limits: PlanLimitsService,
  ) {}

  /** A fresh single-use code for the caller's workspace; only its hash is stored. */
  async createCode(auth: AuthContext): Promise<{ code: string; expiresAt: string }> {
    // Fail early, before a code is handed out; `pair` re-checks under the same row lock.
    await this.dataSource.transaction(async (manager) => {
      const plan = await this.limits.lockPlan(manager, auth.workspaceId);
      await this.limits.assertCanAdd(manager, auth.workspaceId, plan, 'computers');
    });
    const now = this.clock.now();
    const expiresAt = new Date(now.getTime() + PAIRING_TTL_MS);
    const repo = this.dataSource.getRepository(PairingCode);
    await repo
      .createQueryBuilder()
      .delete()
      .where('expires_at < :cutoff', { cutoff: new Date(now.getTime() - PRUNE_AFTER_MS) })
      .execute();
    // Keep at most MAX_ACTIVE_CODES - 1 others alive, so the new one makes MAX_ACTIVE_CODES.
    await repo.query(
      `UPDATE pairing_codes SET used_at = $3
       WHERE id IN (
         SELECT id FROM pairing_codes
         WHERE workspace_id = $1 AND used_at IS NULL AND expires_at > $3
         ORDER BY expires_at DESC, id DESC OFFSET $2
       )`,
      [auth.workspaceId, MAX_ACTIVE_CODES - 1, now],
    );
    for (let attempt = 0; ; attempt++) {
      const code = generateCode();
      try {
        await repo.insert({
          workspaceId: auth.workspaceId,
          createdBy: auth.memberId,
          codeHash: hashCode(code),
          expiresAt,
          usedAt: null,
        });
        return { code, expiresAt: expiresAt.toISOString() };
      } catch (error) {
        const code23505 =
          error instanceof QueryFailedError &&
          (error.driverError as { code?: string } | undefined)?.code === PG_UNIQUE_VIOLATION;
        if (!code23505 || attempt >= 4) throw error;
      }
    }
  }

  /**
   * Consumes the code and creates the computer in one transaction: the `UPDATE ... used_at IS
   * NULL` makes a code usable exactly once even when two daemons race for it.
   */
  async pair(dto: PairDto): Promise<{
    computerId: string;
    apiKey: string;
    workspace: { id: string; name: string; slug: string };
  }> {
    const now = this.clock.now();
    const apiKey = newApiKey();
    const result = await this.dataSource.transaction(async (manager) => {
      const rows = returnedRows<{ workspace_id: string }>(
        await manager.query(
          `UPDATE pairing_codes SET used_at = $2
           WHERE code_hash = $1 AND used_at IS NULL AND expires_at > $2
           RETURNING workspace_id`,
          [hashCode(dto.code), now],
        ),
      );
      if (!rows.length) {
        throw new UnauthorizedException({ message: 'gateway.INVALID_PAIRING_CODE' });
      }
      // Row lock, then count: two daemons pairing at once cannot both take the last slot. A
      // refusal rolls the transaction back, so the code stays usable after an upgrade.
      const plan = await this.limits.lockPlan(manager, rows[0].workspace_id);
      await this.limits.assertCanAdd(manager, rows[0].workspace_id, plan, 'computers');
      const workspace = await manager.findOneByOrFail(Workspace, { id: rows[0].workspace_id });
      const computer = await manager.save(
        manager.create(Computer, {
          workspaceId: workspace.id,
          name: dto.name,
          os: dto.os,
          status: 'online',
          lastHeartbeatAt: now,
          keepAwake: false,
          cliVersion: dto.cliVersion,
          simulated: false,
          apiKeyHash: hashApiKey(apiKey),
        }),
      );
      await this.audit.record(
        {
          workspaceId: workspace.id,
          action: 'computer.paired',
          targetType: 'computer',
          targetId: computer.id,
          meta: { name: computer.name },
        },
        manager,
      );
      return { computer, workspace };
    });
    this.events.publish(result.workspace.id, { type: 'computers.changed' });
    return {
      computerId: result.computer.id,
      apiKey,
      workspace: {
        id: result.workspace.id,
        name: result.workspace.name,
        slug: result.workspace.slug,
      },
    };
  }
}
