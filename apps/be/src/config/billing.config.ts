import { ConfigType, registerAs } from '@nestjs/config';

export const billingConfig = registerAs('billing', () => ({
  /** False (default): plan limits are not enforced and the plan UI is hidden. */
  limitsEnabled: process.env.BILLING_LIMITS_ENABLED === 'true',
  provider: (process.env.BILLING_PROVIDER ?? 'none') as 'none' | 'stripe',
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY ?? '',
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? '',
    pricePro: process.env.STRIPE_PRICE_PRO ?? '',
    priceTeam: process.env.STRIPE_PRICE_TEAM ?? '',
  },
}));

export type BillingConfig = ConfigType<typeof billingConfig>;
