import { envValidationSchema } from './env.validation';

const base = {
  JWT_ACCESS_SECRET: 'x'.repeat(32),
  DB_USERNAME: 'u',
  DB_PASSWORD: 'p',
  DB_NAME: 'n',
};
const prod = { ...base, NODE_ENV: 'production', APP_URL: 'https://app.example.com' };
const smtp = { MAIL_TRANSPORT: 'smtp', SMTP_HOST: 'smtp.example.com', MAIL_FROM: 'A <a@b.co>' };

describe('envValidationSchema mail settings', () => {
  it('defaults to the log transport outside production', () => {
    const { error, value } = envValidationSchema.validate(base);
    expect(error).toBeUndefined();
    expect((value as { MAIL_TRANSPORT: string }).MAIL_TRANSPORT).toBe('log');
  });

  it('refuses the log transport or none in production', () => {
    expect(
      envValidationSchema.validate({ ...prod, ...smtp, MAIL_TRANSPORT: 'log' }).error,
    ).toBeDefined();
    const missing = envValidationSchema.validate({ ...prod, SMTP_HOST: 'h', MAIL_FROM: 'a@b.co' });
    expect(missing.error?.message).toContain('MAIL_TRANSPORT');
  });

  it('needs SMTP_HOST and MAIL_FROM in production', () => {
    expect(
      envValidationSchema.validate({ ...prod, ...smtp, SMTP_HOST: undefined }).error,
    ).toBeDefined();
    expect(
      envValidationSchema.validate({ ...prod, ...smtp, MAIL_FROM: undefined }).error,
    ).toBeDefined();
    expect(envValidationSchema.validate({ ...prod, ...smtp }).error).toBeUndefined();
  });
});

describe('envValidationSchema billing settings', () => {
  const stripe = {
    BILLING_PROVIDER: 'stripe',
    STRIPE_SECRET_KEY: 'sk_test_x',
    STRIPE_WEBHOOK_SECRET: 'whsec_x',
    STRIPE_PRICE_PRO: 'price_pro',
    STRIPE_PRICE_TEAM: 'price_team',
  };

  it('defaults to no provider and needs no Stripe keys', () => {
    const { error, value } = envValidationSchema.validate(base);
    expect(error).toBeUndefined();
    expect((value as { BILLING_PROVIDER: string }).BILLING_PROVIDER).toBe('none');
  });

  it('requires every Stripe setting once the stripe provider is on', () => {
    expect(envValidationSchema.validate({ ...base, ...stripe }).error).toBeUndefined();
    for (const key of Object.keys(stripe).filter((k) => k !== 'BILLING_PROVIDER')) {
      const result = envValidationSchema.validate({ ...base, ...stripe, [key]: undefined });
      expect(result.error?.message).toContain(key);
    }
  });

  it('accepts blank Stripe settings while the provider is none (compose passes empty strings)', () => {
    const blank = {
      STRIPE_SECRET_KEY: '',
      STRIPE_WEBHOOK_SECRET: '',
      STRIPE_PRICE_PRO: '',
      STRIPE_PRICE_TEAM: '',
    };
    expect(envValidationSchema.validate({ ...base, ...blank }).error).toBeUndefined();
    expect(
      envValidationSchema.validate({ ...base, ...blank, BILLING_PROVIDER: 'stripe' }).error,
    ).toBeDefined();
  });

  it('rejects an unknown provider', () => {
    expect(
      envValidationSchema.validate({ ...base, BILLING_PROVIDER: 'paypal' }).error,
    ).toBeDefined();
  });
});

describe('envValidationSchema production guards', () => {
  const ok = { ...prod, ...smtp };
  const messageOf = (env: Record<string, unknown>): string | undefined =>
    envValidationSchema.validate(env).error?.message;

  it('accepts a complete production environment', () => {
    const { error, value } = envValidationSchema.validate(ok);
    expect(error).toBeUndefined();
    const parsed = value as Record<string, unknown>;
    expect(parsed.SWAGGER_ENABLED).toBe(false);
    expect(parsed.CONNECTIONS_MODE).toBe('disabled');
  });

  it('rejects the public JWT secrets from the repo', () => {
    for (const secret of [
      'change-me-to-a-long-random-string-at-least-32-chars',
      'dev-only-insecure-secret-change-me-0123456789',
    ]) {
      expect(messageOf({ ...ok, JWT_ACCESS_SECRET: secret })).toContain('JWT_ACCESS_SECRET');
    }
    // The same values stay fine for local development.
    expect(
      envValidationSchema.validate({
        ...base,
        JWT_ACCESS_SECRET: 'dev-only-insecure-secret-change-me-0123456789',
      }).error,
    ).toBeUndefined();
  });

  it('rejects the simulator, an empty DB password and simulated connections', () => {
    expect(messageOf({ ...ok, AGENT_SIMULATOR: 'true' })).toContain('AGENT_SIMULATOR');
    expect(messageOf({ ...ok, DB_PASSWORD: '' })).toContain('DB_PASSWORD');
    expect(messageOf({ ...ok, CONNECTIONS_MODE: 'simulated' })).toContain('CONNECTIONS_MODE');
    expect(
      envValidationSchema.validate({ ...base, AGENT_SIMULATOR: 'true', DB_PASSWORD: '' }).error,
    ).toBeUndefined();
  });

  it('requires APP_URL in production only', () => {
    expect(messageOf({ ...ok, APP_URL: undefined })).toContain('APP_URL');
    const { value } = envValidationSchema.validate(base);
    expect((value as { APP_URL: string }).APP_URL).toBe('http://localhost:1420');
  });

  it('turns Swagger on by default outside production and lets production opt in', () => {
    const dev = envValidationSchema.validate(base).value as { SWAGGER_ENABLED: boolean };
    expect(dev.SWAGGER_ENABLED).toBe(true);
    const prodOn = envValidationSchema.validate({ ...ok, SWAGGER_ENABLED: 'true' }).value as {
      SWAGGER_ENABLED: boolean;
    };
    expect(prodOn.SWAGGER_ENABLED).toBe(true);
  });

  it('defaults connections to simulated outside production', () => {
    const { value } = envValidationSchema.validate(base);
    expect((value as { CONNECTIONS_MODE: string }).CONNECTIONS_MODE).toBe('simulated');
  });
});
