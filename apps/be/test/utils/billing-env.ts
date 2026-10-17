/**
 * Side-effect import: must come before anything that imports AppModule (see low-throttle-env).
 * Switches the Stripe provider on for one spec file; the SDK itself is replaced by
 * `FakeStripeGateway`, so Stripe is never called.
 */
process.env.BILLING_PROVIDER = 'stripe';
process.env.STRIPE_SECRET_KEY = 'sk_test_e2e';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_e2e';
process.env.STRIPE_PRICE_PRO = 'price_pro_e2e';
process.env.STRIPE_PRICE_TEAM = 'price_team_e2e';
