import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import {
  planById,
  type BillingSummary,
  type BillingUrlResult,
  type CheckoutInput,
  type SubscriptionStatus,
  type WorkspacePlan,
} from '@repo/shared';
import { DataSource } from 'typeorm';
import { ClockService } from '../../common/clock';
import type { AuthContext } from '../../common/types';
import { appConfig, billingConfig } from '../../config';
import { WORKSPACE_TIMEZONE } from '../../contacts';
import { PlanLimitsService } from './plan-limits.service';
import { StripeGateway } from './stripe.gateway';

const ACTIVE_STATUSES = ['active', 'trialing', 'past_due'];

interface WorkspaceBillingRow {
  plan: WorkspacePlan;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  subscription_status: SubscriptionStatus | null;
  current_period_end: Date | null;
  cancel_at_period_end: boolean;
}

const money = (value: unknown): number => Math.round(Number(value) * 1e6) / 1e6;

@Injectable()
export class BillingService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly clock: ClockService,
    private readonly limits: PlanLimitsService,
    private readonly gateway: StripeGateway,
    @Inject(billingConfig.KEY) private readonly config: ConfigType<typeof billingConfig>,
    @Inject(appConfig.KEY) private readonly app: ConfigType<typeof appConfig>,
  ) {}

  get checkoutAvailable(): boolean {
    return this.config.provider === 'stripe';
  }

  async summary(workspaceId: string): Promise<BillingSummary> {
    const workspace = await this.workspaceRow(workspaceId);
    const manager = this.dataSource.manager;
    const now = this.clock.now();
    const usage = await this.limits.usage(manager, workspaceId);

    const [bounds] = await manager.query<{ period_start: Date; period_end: Date }[]>(
      `WITH local AS (SELECT date_trunc('month', $1::timestamptz AT TIME ZONE $2) AS month)
       SELECT (month AT TIME ZONE $2) AS period_start,
              ((month + interval '1 month') AT TIME ZONE $2) AS period_end
       FROM local`,
      [now, WORKSPACE_TIMEZONE],
    );

    // Demo (simulated) machines never cost anything and their runs are scripted: not counted.
    // `cost` sums every ended assignment that reports a cost (a cancelled run still spent money);
    // `runs` keeps meaning "finished runs": completed + failed only.
    const byAgentRows = await manager.query<
      { agent_id: string; name: string; cost: string; runs: string }[]
    >(
      `SELECT a.agent_id, ag.name, COALESCE(SUM(a.cost_usd), 0) AS cost,
              count(*) FILTER (WHERE a.status IN ('completed', 'failed')) AS runs
       FROM assignments a
       JOIN computers c ON c.id = a.computer_id AND c.simulated = false
       JOIN agents ag ON ag.id = a.agent_id
       WHERE a.workspace_id = $1 AND a.status IN ('completed', 'failed', 'cancelled', 'expired')
         AND (a.status IN ('completed', 'failed') OR a.cost_usd IS NOT NULL)
         AND a.ended_at >= $2 AND a.ended_at < $3
       GROUP BY a.agent_id, ag.name
       ORDER BY cost DESC, runs DESC, ag.name ASC`,
      [workspaceId, bounds.period_start, bounds.period_end],
    );
    const byDayRows = await manager.query<{ day: string; cost: string; runs: string }[]>(
      `SELECT to_char((a.ended_at AT TIME ZONE $4)::date, 'YYYY-MM-DD') AS day,
              COALESCE(SUM(a.cost_usd), 0) AS cost,
              count(*) FILTER (WHERE a.status IN ('completed', 'failed')) AS runs
       FROM assignments a
       JOIN computers c ON c.id = a.computer_id AND c.simulated = false
       WHERE a.workspace_id = $1 AND a.status IN ('completed', 'failed', 'cancelled', 'expired')
         AND (a.status IN ('completed', 'failed') OR a.cost_usd IS NOT NULL)
         AND a.ended_at >= $2 AND a.ended_at < $3
       GROUP BY 1 ORDER BY 1`,
      [workspaceId, bounds.period_start, bounds.period_end, WORKSPACE_TIMEZONE],
    );
    const byAgent = byAgentRows.map((row) => ({
      agentId: row.agent_id,
      name: row.name,
      costUsd: money(row.cost),
      runs: Number(row.runs),
    }));
    const byDay = byDayRows.map((row) => ({
      date: row.day,
      costUsd: money(row.cost),
      runs: Number(row.runs),
    }));

    const { seats, agents, computers } = planById(workspace.plan);
    return {
      plan: workspace.plan,
      limits: { seats, agents, computers },
      usage,
      period: {
        start: bounds.period_start.toISOString(),
        end: bounds.period_end.toISOString(),
      },
      costUsd: money(byDay.reduce((sum, day) => sum + day.costUsd, 0)),
      runs: byDay.reduce((sum, day) => sum + day.runs, 0),
      byAgent,
      byDay,
      subscription: workspace.subscription_status
        ? {
            status: workspace.subscription_status,
            currentPeriodEnd: workspace.current_period_end?.toISOString() ?? null,
            cancelAtPeriodEnd: workspace.cancel_at_period_end,
          }
        : null,
      checkoutAvailable: this.checkoutAvailable,
      limitsEnabled: this.limits.limitsEnabled,
    };
  }

  async checkout(auth: AuthContext, input: CheckoutInput): Promise<BillingUrlResult> {
    this.assertAvailable();
    const workspace = await this.workspaceRow(auth.workspaceId);
    if (
      workspace.stripe_subscription_id &&
      workspace.subscription_status &&
      ACTIVE_STATUSES.includes(workspace.subscription_status)
    ) {
      throw new ConflictException({ message: 'billing.ALREADY_SUBSCRIBED' });
    }
    const [owner] = await this.dataSource.query<{ email: string }[]>(
      'SELECT email FROM members WHERE id = $1',
      [auth.memberId],
    );
    // Billed seats are the live members (what seat sync sends); pending invites join the quantity
    // only once accepted, though they still count against the plan limit.
    const [{ members }] = await this.dataSource.query<{ members: string }[]>(
      'SELECT count(*) AS members FROM members WHERE workspace_id = $1 AND removed_at IS NULL',
      [auth.workspaceId],
    );
    return this.gateway.createCheckoutSession({
      priceId: input.plan === 'pro' ? this.config.stripe.pricePro : this.config.stripe.priceTeam,
      quantity: input.plan === 'team' ? Math.max(1, Number(members)) : 1,
      workspaceId: auth.workspaceId,
      customerId: workspace.stripe_customer_id,
      customerEmail: owner?.email ?? '',
      successUrl: `${this.app.appUrl}/#/settings/billing?checkout=success`,
      cancelUrl: `${this.app.appUrl}/#/settings/billing?checkout=cancel`,
    });
  }

  async portal(auth: AuthContext): Promise<BillingUrlResult> {
    this.assertAvailable();
    const workspace = await this.workspaceRow(auth.workspaceId);
    if (!workspace.stripe_customer_id)
      throw new ConflictException({ message: 'billing.NO_CUSTOMER' });
    return this.gateway.createPortalSession({
      customerId: workspace.stripe_customer_id,
      returnUrl: `${this.app.appUrl}/#/settings/billing`,
    });
  }

  private assertAvailable(): void {
    if (!this.checkoutAvailable) throw new ConflictException({ message: 'billing.UNAVAILABLE' });
  }

  private async workspaceRow(workspaceId: string): Promise<WorkspaceBillingRow> {
    const rows = await this.dataSource.query<WorkspaceBillingRow[]>(
      `SELECT plan, stripe_customer_id, stripe_subscription_id, subscription_status,
              current_period_end, cancel_at_period_end
       FROM workspaces WHERE id = $1`,
      [workspaceId],
    );
    if (!rows[0]) throw new NotFoundException({ message: 'workspace.NOT_FOUND' });
    return rows[0];
  }
}
