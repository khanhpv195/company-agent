import { Inject, Injectable } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import Stripe from 'stripe';
import { billingConfig } from '../../config';

/** The slice of a Stripe event the billing code reads. */
export interface StripeEventLike {
  id: string;
  type: string;
  /** Unix seconds: when Stripe created the event (used to drop out-of-order deliveries). */
  created?: number;
  data: { object: Record<string, unknown> };
}

/** The slice of a Stripe subscription the billing code reads. */
export interface StripeSubscriptionLike {
  id: string;
  customer: string | { id: string };
  status: string;
  cancel_at_period_end: boolean;
  /** Older API versions. */
  current_period_end?: number;
  items: { data: { price: { id: string }; current_period_end?: number }[] };
  metadata?: Record<string, string>;
}

/** Stripe's minimum for `expires_at` is 30 minutes; one extra minute covers request latency. */
export const CHECKOUT_TTL_SECONDS = 31 * 60;

export interface CheckoutSessionInput {
  priceId: string;
  quantity: number;
  workspaceId: string;
  /** Reuse the workspace's customer when it has one. */
  customerId: string | null;
  customerEmail: string;
  successUrl: string;
  cancelUrl: string;
}

/**
 * Everything the app needs from Stripe, behind one injectable class: e2e tests replace the
 * network calls (never call Stripe from a test) and keep the local signature check.
 */
export abstract class StripeGateway {
  abstract createCheckoutSession(input: CheckoutSessionInput): Promise<{ url: string }>;
  abstract createPortalSession(input: {
    customerId: string;
    returnUrl: string;
  }): Promise<{ url: string }>;
  abstract retrieveSubscription(id: string): Promise<StripeSubscriptionLike>;
  /** Cancels a subscription immediately (used for duplicate paid checkouts). */
  abstract cancelSubscription(id: string): Promise<void>;
  /** Updates the billing email of a Stripe customer (the workspace's new owner). */
  abstract updateCustomerEmail(customerId: string, email: string): Promise<void>;
  /** Sets the seat quantity of the subscription's single item. */
  abstract updateSubscriptionQuantity(id: string, quantity: number): Promise<void>;
  /** Verifies the `Stripe-Signature` header over the raw body; throws when it does not match. */
  abstract constructEvent(rawBody: Buffer, signature: string): StripeEventLike;
}

@Injectable()
export class StripeSdkGateway extends StripeGateway {
  protected readonly stripe: Stripe;

  constructor(
    @Inject(billingConfig.KEY) protected readonly config: ConfigType<typeof billingConfig>,
  ) {
    super();
    this.stripe = new Stripe(config.stripe.secretKey, { timeout: 10_000, maxNetworkRetries: 1 });
  }

  async createCheckoutSession(input: CheckoutSessionInput): Promise<{ url: string }> {
    const session = await this.stripe.checkout.sessions.create({
      mode: 'subscription',
      client_reference_id: input.workspaceId,
      line_items: [{ price: input.priceId, quantity: input.quantity }],
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      ...(input.customerId
        ? { customer: input.customerId }
        : { customer_email: input.customerEmail }),
      expires_at: Math.floor(Date.now() / 1000) + CHECKOUT_TTL_SECONDS,
      subscription_data: { metadata: { workspaceId: input.workspaceId } },
    });
    if (!session.url) throw new Error('Stripe returned a checkout session without a url');
    return { url: session.url };
  }

  async createPortalSession(input: {
    customerId: string;
    returnUrl: string;
  }): Promise<{ url: string }> {
    const session = await this.stripe.billingPortal.sessions.create({
      customer: input.customerId,
      return_url: input.returnUrl,
    });
    return { url: session.url };
  }

  async retrieveSubscription(id: string): Promise<StripeSubscriptionLike> {
    return (await this.stripe.subscriptions.retrieve(id)) as unknown as StripeSubscriptionLike;
  }

  /** Idempotent: a subscription that is already canceled or gone counts as cancelled. */
  async cancelSubscription(id: string): Promise<void> {
    try {
      const current = await this.stripe.subscriptions.retrieve(id);
      if (current.status === 'canceled') return;
      await this.stripe.subscriptions.cancel(id);
    } catch (error) {
      if (
        error instanceof Stripe.errors.StripeInvalidRequestError &&
        error.code === 'resource_missing'
      ) {
        return;
      }
      throw error;
    }
  }

  async updateCustomerEmail(customerId: string, email: string): Promise<void> {
    await this.stripe.customers.update(customerId, { email });
  }

  async updateSubscriptionQuantity(id: string, quantity: number): Promise<void> {
    const subscription = await this.stripe.subscriptions.retrieve(id);
    const item = subscription.items.data[0];
    if (!item) return;
    await this.stripe.subscriptions.update(id, {
      items: [{ id: item.id, quantity }],
      proration_behavior: 'create_prorations',
    });
  }

  constructEvent(rawBody: Buffer, signature: string): StripeEventLike {
    return this.stripe.webhooks.constructEvent(
      rawBody,
      signature,
      this.config.stripe.webhookSecret,
    ) as unknown as StripeEventLike;
  }
}

/** `BILLING_PROVIDER=none`: nothing is wired and the billing routes answer 409. */
@Injectable()
export class DisabledStripeGateway extends StripeGateway {
  private fail(): never {
    throw new Error('Billing provider is disabled');
  }
  createCheckoutSession(): Promise<{ url: string }> {
    return this.fail();
  }
  createPortalSession(): Promise<{ url: string }> {
    return this.fail();
  }
  retrieveSubscription(): Promise<StripeSubscriptionLike> {
    return this.fail();
  }
  cancelSubscription(): Promise<void> {
    return this.fail();
  }
  updateCustomerEmail(): Promise<void> {
    return this.fail();
  }
  updateSubscriptionQuantity(): Promise<void> {
    return this.fail();
  }
  constructEvent(): StripeEventLike {
    return this.fail();
  }
}
