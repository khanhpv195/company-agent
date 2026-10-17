import { BadRequestException, ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import type { SubscriptionStatus, WorkspacePlan } from '@repo/shared';
import { isUUID } from 'class-validator';
import { DataSource, EntityManager } from 'typeorm';
import { transactionWithEffects } from '../../common/utils';
import { billingConfig } from '../../config';
import { AuditService } from '../audit/audit.service';
import { EventsService } from '../events';
import { StripeGateway, type StripeEventLike, type StripeSubscriptionLike } from './stripe.gateway';

interface WorkspaceRow {
  id: string;
  plan: WorkspacePlan;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  subscription_status: SubscriptionStatus | null;
  stripe_event_created: Date | null;
}

/**
 * Stripe statuses that no longer give paid access. `unpaid` and `paused` keep the subscription
 * (stored as `past_due`, so checkout stays blocked and the owner fixes it in the portal) but the
 * workspace drops to the free plan. A plain `past_due` (payment retries running) keeps access.
 */
const NO_ACCESS_STATUSES = ['unpaid', 'paused', 'incomplete_expired', 'canceled'];

/** Stripe statuses mapped to the ones we store. */
const mapStatus = (status: string): SubscriptionStatus => {
  switch (status) {
    case 'active':
    case 'trialing':
    case 'past_due':
    case 'canceled':
    case 'incomplete':
      return status;
    case 'incomplete_expired':
      return 'canceled';
    default:
      // unpaid, paused: see NO_ACCESS_STATUSES.
      return 'past_due';
  }
};

const customerId = (customer: StripeSubscriptionLike['customer']): string =>
  typeof customer === 'string' ? customer : customer.id;

const asString = (value: unknown): string | null => (typeof value === 'string' ? value : null);

@Injectable()
export class BillingWebhookService {
  private readonly logger = new Logger(BillingWebhookService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly gateway: StripeGateway,
    private readonly audit: AuditService,
    private readonly events: EventsService,
    @Inject(billingConfig.KEY) private readonly config: ConfigType<typeof billingConfig>,
  ) {}

  /** Verifies the signature, then applies the event exactly once (by event id). */
  async handle(rawBody: Buffer | undefined, signature: string | undefined): Promise<void> {
    if (this.config.provider !== 'stripe') {
      throw new ConflictException({ message: 'billing.UNAVAILABLE' });
    }
    if (!rawBody || !signature) {
      throw new BadRequestException({ message: 'billing.INVALID_SIGNATURE' });
    }
    let event: StripeEventLike;
    try {
      event = this.gateway.constructEvent(rawBody, signature);
    } catch {
      throw new BadRequestException({ message: 'billing.INVALID_SIGNATURE' });
    }

    // Network call first (no row lock is held while Stripe answers). The payload of an event is
    // a snapshot from when it was created and events can arrive out of order, so we never apply
    // it: we ask Stripe for the subscription as it is now and apply that.
    let subscription: StripeSubscriptionLike | null = null;
    let customer: string | null = null;
    let workspaceHint: string | null = null;
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const subscriptionId = asString(session.subscription);
      const workspaceId = asString(session.client_reference_id);
      if (session.mode === 'subscription' && subscriptionId && workspaceId && isUUID(workspaceId)) {
        subscription = await this.gateway.retrieveSubscription(subscriptionId);
        customer = asString(session.customer);
        workspaceHint = workspaceId;
      }
    } else if (event.type.startsWith('customer.subscription.')) {
      const subscriptionId = asString(event.data.object.id);
      if (subscriptionId) subscription = await this.gateway.retrieveSubscription(subscriptionId);
    }
    const eventCreated = new Date((event.created ?? 0) * 1000);
    let duplicateToCancel: string | null = null;

    await transactionWithEffects(this.dataSource, async (manager, effects) => {
      // Same transaction as the change: a failure rolls the marker back and Stripe retries.
      const inserted = await manager.query<{ id: string }[]>(
        `INSERT INTO stripe_events (id, type) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING RETURNING id`,
        [event.id, event.type],
      );
      if (!inserted.length || !subscription) return;

      const workspace = workspaceHint
        ? await this.lock(manager, 'id', workspaceHint)
        : await this.findForSubscription(manager, subscription);
      if (!workspace) return;

      // A newer event was already applied: this one is a late delivery.
      if (workspace.stripe_event_created && eventCreated < workspace.stripe_event_created) return;

      const alive = ['active', 'trialing', 'past_due'];
      const other =
        !!workspace.stripe_subscription_id &&
        workspace.stripe_subscription_id !== subscription.id &&
        alive.includes(workspace.subscription_status ?? '');
      if (other) {
        // A second paid subscription for a workspace that already has one: refund-free cancel
        // (after the commit); an event about an old or dead subscription is just ignored.
        if (alive.includes(subscription.status)) {
          this.logger.warn(
            `Workspace ${workspace.id} already has subscription ${workspace.stripe_subscription_id}; canceling duplicate ${subscription.id}`,
          );
          duplicateToCancel = subscription.id;
          await this.audit.record(
            {
              workspaceId: workspace.id,
              action: 'billing.duplicate_subscription_canceled',
              targetType: 'workspace',
              targetId: workspace.id,
              meta: {
                kept: workspace.stripe_subscription_id,
                canceled: subscription.id,
                eventId: event.id,
              },
            },
            manager,
          );
        }
        return;
      }

      const status = mapStatus(subscription.status);
      const price = subscription.items?.data?.[0]?.price?.id;
      let plan: WorkspacePlan = workspace.plan;
      if (status === 'canceled' || NO_ACCESS_STATUSES.includes(subscription.status)) plan = 'free';
      else if (status !== 'incomplete') {
        const known = this.planOfPrice(price);
        if (known) plan = known;
        else this.logger.warn(`Unknown Stripe price "${price}" on subscription ${subscription.id}`);
      }
      const periodEnd =
        subscription.current_period_end ?? subscription.items?.data?.[0]?.current_period_end;

      await manager.query(
        `UPDATE workspaces SET plan = $2, stripe_customer_id = $3, stripe_subscription_id = $4,
           subscription_status = $5, current_period_end = $6, cancel_at_period_end = $7,
           stripe_event_created = $8, updated_at = now()
         WHERE id = $1`,
        [
          workspace.id,
          plan,
          customer ?? customerId(subscription.customer) ?? workspace.stripe_customer_id,
          subscription.id,
          status,
          periodEnd ? new Date(periodEnd * 1000) : null,
          status === 'canceled' ? false : !!subscription.cancel_at_period_end,
          eventCreated,
        ],
      );
      if (plan !== workspace.plan) {
        await this.audit.record(
          {
            workspaceId: workspace.id,
            action: 'billing.plan_changed',
            targetType: 'workspace',
            targetId: workspace.id,
            meta: { from: workspace.plan, to: plan, status, eventId: event.id },
          },
          manager,
        );
      }
      const workspaceId = workspace.id;
      effects.push(() => this.events.publish(workspaceId, { type: 'workspace.changed' }));
    });

    if (duplicateToCancel) {
      try {
        await this.gateway.cancelSubscription(duplicateToCancel);
      } catch (error) {
        // The audit row and the marker are committed: do not make Stripe replay the event.
        this.logger.error(
          `Could not cancel duplicate subscription ${duplicateToCancel}: ${String(error)}`,
        );
      }
    }
  }

  private planOfPrice(price: string | undefined): Exclude<WorkspacePlan, 'free'> | null {
    if (!price) return null;
    if (price === this.config.stripe.pricePro) return 'pro';
    if (price === this.config.stripe.priceTeam) return 'team';
    return null;
  }

  private async lock(
    manager: EntityManager,
    column: 'id' | 'stripe_subscription_id' | 'stripe_customer_id',
    value: string,
  ): Promise<WorkspaceRow | null> {
    const rows = await manager.query<WorkspaceRow[]>(
      `SELECT id, plan, stripe_customer_id, stripe_subscription_id, subscription_status,
              stripe_event_created
       FROM workspaces WHERE ${column} = $1 LIMIT 1 FOR UPDATE`,
      [value],
    );
    return rows[0] ?? null;
  }

  /** The workspace id we put in the subscription metadata, else the stored subscription or customer. */
  private async findForSubscription(
    manager: EntityManager,
    subscription: StripeSubscriptionLike,
  ): Promise<WorkspaceRow | null> {
    const fromMetadata = subscription.metadata?.workspaceId;
    return (
      (fromMetadata && isUUID(fromMetadata)
        ? await this.lock(manager, 'id', fromMetadata)
        : null) ??
      (await this.lock(manager, 'stripe_subscription_id', subscription.id)) ??
      (await this.lock(manager, 'stripe_customer_id', customerId(subscription.customer)))
    );
  }
}
