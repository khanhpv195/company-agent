import type {
  CheckoutSessionInput,
  StripeSubscriptionLike,
} from '../../src/modules/billing/stripe.gateway';
import { StripeSdkGateway } from '../../src/modules/billing/stripe.gateway';

export const STRIPE_E2E = {
  secretKey: 'sk_test_e2e',
  webhookSecret: 'whsec_e2e',
  pricePro: 'price_pro_e2e',
  priceTeam: 'price_team_e2e',
};

/**
 * The real gateway with its network calls replaced: signature checking stays real (it is a local
 * HMAC), checkout / portal / subscription lookups are recorded or served from memory.
 */
export class FakeStripeGateway extends StripeSdkGateway {
  checkouts: CheckoutSessionInput[] = [];
  portals: { customerId: string; returnUrl: string }[] = [];
  canceled: string[] = [];
  quantities: { id: string; quantity: number }[] = [];
  /** Makes `updateSubscriptionQuantity` throw (seat sync must stay best-effort). */
  failQuantity = false;
  /** Makes `cancelSubscription` throw. */
  failCancel = false;
  /** Runs inside `cancelSubscription` (to observe what the caller holds while Stripe is called). */
  onCancel: (() => Promise<void>) | null = null;
  emails: { customerId: string; email: string }[] = [];
  /** Makes `updateCustomerEmail` throw. */
  failEmail = false;
  retrieved: string[] = [];
  subscriptions = new Map<string, StripeSubscriptionLike>();

  constructor() {
    super({ limitsEnabled: true, provider: 'stripe', stripe: STRIPE_E2E });
  }

  reset(): void {
    this.checkouts = [];
    this.portals = [];
    this.subscriptions.clear();
    this.canceled = [];
    this.quantities = [];
    this.retrieved = [];
    this.failQuantity = false;
    this.failCancel = false;
    this.onCancel = null;
    this.failEmail = false;
    this.emails = [];
  }

  override createCheckoutSession(input: CheckoutSessionInput): Promise<{ url: string }> {
    this.checkouts.push(input);
    return Promise.resolve({ url: `https://checkout.stripe.test/c/${this.checkouts.length}` });
  }

  override createPortalSession(input: {
    customerId: string;
    returnUrl: string;
  }): Promise<{ url: string }> {
    this.portals.push(input);
    return Promise.resolve({ url: `https://billing.stripe.test/p/${input.customerId}` });
  }

  override retrieveSubscription(id: string): Promise<StripeSubscriptionLike> {
    this.retrieved.push(id);
    const subscription = this.subscriptions.get(id);
    if (!subscription) return Promise.reject(new Error(`unknown subscription ${id}`));
    return Promise.resolve(subscription);
  }

  override async cancelSubscription(id: string): Promise<void> {
    if (this.onCancel) await this.onCancel();
    if (this.failCancel) throw new Error('stripe down');
    this.canceled.push(id);
    const subscription = this.subscriptions.get(id);
    if (subscription) this.subscriptions.set(id, { ...subscription, status: 'canceled' });
  }

  override updateCustomerEmail(customerId: string, email: string): Promise<void> {
    if (this.failEmail) return Promise.reject(new Error('stripe down'));
    this.emails.push({ customerId, email });
    return Promise.resolve();
  }

  override updateSubscriptionQuantity(id: string, quantity: number): Promise<void> {
    if (this.failQuantity) return Promise.reject(new Error('stripe down'));
    this.quantities.push({ id, quantity });
    return Promise.resolve();
  }
}
