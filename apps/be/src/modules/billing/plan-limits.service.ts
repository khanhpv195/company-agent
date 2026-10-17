import { ForbiddenException, Injectable } from '@nestjs/common';
import {
  BILLING_LIMIT_REACHED,
  planById,
  type LimitReachedDetails,
  type PlanResource,
  type WorkspacePlan,
} from '@repo/shared';
import type { EntityManager } from 'typeorm';
import { ClockService } from '../../common/clock';
import { WorkspaceGoneException } from '../tasks/workspace-lock.service';

/**
 * 403 `billing.LIMIT_REACHED`. The message names the resource and the limit (see
 * `billing.json`); `meta.details` carries the same facts for the client.
 */
export class LimitReachedException extends ForbiddenException {
  constructor(details: LimitReachedDetails) {
    super({
      message: BILLING_LIMIT_REACHED,
      // `$t(...)` is resolved by nestjs-i18n after interpolation: the resource name is localized.
      args: {
        resource: `$t(billing.resources.${details.resource})`,
        limit: details.limit,
        plan: details.plan,
      },
      details,
    });
  }
}

/**
 * Plan limits. Every enforcement point calls `lockPlan` first inside its own transaction: the
 * workspace row lock serialises limit-checked writers (two invites, two pairings...), so the
 * count that follows cannot be outrun. Downgrades never delete anything: a workspace above its
 * limit just cannot add more.
 */
@Injectable()
export class PlanLimitsService {
  constructor(private readonly clock: ClockService) {}

  /** Locks the workspace row until the transaction ends and returns its plan. */
  async lockPlan(manager: EntityManager, workspaceId: string): Promise<WorkspacePlan> {
    const rows = await manager.query<{ plan: WorkspacePlan }[]>(
      'SELECT plan FROM workspaces WHERE id = $1 FOR UPDATE',
      [workspaceId],
    );
    if (!rows[0]) throw new WorkspaceGoneException();
    return rows[0].plan;
  }

  /** Seats count members and pending invites; computers skip revoked and demo machines; agents skip deleted ones and those on demo (simulated) machines. */
  async usage(manager: EntityManager, workspaceId: string): Promise<Record<PlanResource, number>> {
    const rows = await manager.query<{ seats: string; agents: string; computers: string }[]>(
      `SELECT
         (SELECT count(*) FROM members WHERE workspace_id = $1 AND removed_at IS NULL)
         + (SELECT count(*) FROM invites WHERE workspace_id = $1 AND accepted_at IS NULL
              AND revoked_at IS NULL AND expires_at > $2) AS seats,
         (SELECT count(*) FROM agents a JOIN computers ac ON ac.id = a.computer_id
            WHERE a.workspace_id = $1 AND a.deleted_at IS NULL AND ac.simulated = false) AS agents,
         (SELECT count(*) FROM computers WHERE workspace_id = $1 AND revoked_at IS NULL
            AND simulated = false) AS computers`,
      [workspaceId, this.clock.now()],
    );
    const row = rows[0];
    return {
      seats: Number(row.seats),
      agents: Number(row.agents),
      computers: Number(row.computers),
    };
  }

  /**
   * Throws when adding `adding` more of `resource` would pass the plan limit. Call it after
   * `lockPlan` in the same transaction (pass its result as `plan`).
   */
  async assertCanAdd(
    manager: EntityManager,
    workspaceId: string,
    plan: WorkspacePlan,
    resource: PlanResource,
    adding = 1,
  ): Promise<void> {
    const limit = planById(plan)[resource];
    const used = (await this.usage(manager, workspaceId))[resource];
    if (used + adding > limit) throw new LimitReachedException({ resource, limit, used, plan });
  }
}
