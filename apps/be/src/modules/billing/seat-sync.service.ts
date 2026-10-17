import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { StripeGateway } from './stripe.gateway';

/**
 * Keeps the Stripe quantity of a team subscription equal to the live members. Call it after the
 * commit of a change that adds or removes a member. It is best-effort by design: the member
 * change already happened, so a Stripe error is logged and swallowed, and the next change
 * resends the then-current count (the count is read fresh each time, so a late call corrects
 * an earlier one). Pending invites are not billed until accepted.
 */
@Injectable()
export class SeatSyncService {
  private readonly logger = new Logger(SeatSyncService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly gateway: StripeGateway,
  ) {}

  async sync(workspaceId: string): Promise<void> {
    try {
      const rows = await this.dataSource.query<{ sub: string; seats: string }[]>(
        `SELECT w.stripe_subscription_id AS sub,
                (SELECT count(*) FROM members m
                   WHERE m.workspace_id = w.id AND m.removed_at IS NULL) AS seats
         FROM workspaces w
         WHERE w.id = $1 AND w.plan = 'team' AND w.stripe_subscription_id IS NOT NULL
           AND w.subscription_status IN ('active', 'trialing', 'past_due')`,
        [workspaceId],
      );
      if (!rows[0]) return;
      await this.gateway.updateSubscriptionQuantity(
        rows[0].sub,
        Math.max(1, Number(rows[0].seats)),
      );
    } catch (error) {
      this.logger.error(`Seat sync failed for workspace ${workspaceId}: ${String(error)}`);
    }
  }
}
