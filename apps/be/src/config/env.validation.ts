import { SupportedLanguage } from '@repo/shared';
import * as Joi from 'joi';
import { DEFAULT_CORS_ORIGINS } from '../contacts';

/** `<number>[s|m|h|d]`, see `parseDuration`. */
const DURATION_PATTERN = /^\d+[smhd]$/;

/** Required (non-empty) with `BILLING_PROVIDER=stripe`; may be blank otherwise (compose passes ''). */
const stripeSetting = Joi.string().when('BILLING_PROVIDER', {
  is: 'stripe',
  then: Joi.required(),
  otherwise: Joi.string().allow('').optional(),
});

/** Placeholders that ship in the repo (`.env.example`, `docker/be.dev.env`): never valid in production. */
const PUBLIC_SECRET_PATTERN = /change-me|dev-only/i;

const isProduction = { is: 'production' };

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  PORT: Joi.number().port().default(3000),
  CORS_ORIGINS: Joi.string().default(DEFAULT_CORS_ORIGINS.join(',')),
  // Swagger exposes the whole API surface: off by default in production.
  SWAGGER_ENABLED: Joi.boolean().when('NODE_ENV', {
    ...isProduction,
    then: Joi.boolean().default(false),
    otherwise: Joi.boolean().default(true),
  }),
  // Express `trust proxy`: false, `true` or the number of proxy hops in front of the API.
  TRUST_PROXY: Joi.alternatives().try(Joi.boolean(), Joi.number().integer().min(0)).default(false),
  LOG_LEVEL: Joi.string()
    .valid('fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent')
    .default('info'),
  API_THROTTLE_LIMIT: Joi.number().integer().min(1).default(600),
  GATEWAY_THROTTLE_LIMIT: Joi.number().integer().min(1).default(1200),
  RETENTION_ENABLED: Joi.boolean().default(true),
  AUDIT_RETENTION_DAYS: Joi.number().integer().min(1).default(365),
  // Zalo/Facebook/Gmail OAuth is simulated: production must not offer the demo flow.
  CONNECTIONS_MODE: Joi.string().when('NODE_ENV', {
    ...isProduction,
    then: Joi.string().valid('disabled').default('disabled').messages({
      'any.only': 'CONNECTIONS_MODE must be disabled in production (providers are simulated)',
    }),
    otherwise: Joi.string().valid('simulated', 'disabled').default('simulated'),
  }),
  FALLBACK_LANGUAGE: Joi.string()
    .valid(...Object.values(SupportedLanguage))
    .default(SupportedLanguage.EN),

  JWT_ACCESS_SECRET: Joi.string()
    .min(32)
    .required()
    .when('NODE_ENV', {
      ...isProduction,
      then: Joi.string().pattern(PUBLIC_SECRET_PATTERN, { invert: true }).messages({
        'string.pattern.invert.base':
          'JWT_ACCESS_SECRET is a public placeholder from the repo: generate one with `openssl rand -base64 48`',
      }),
    }),
  JWT_ACCESS_TTL: Joi.string().pattern(DURATION_PATTERN).default('15m'),
  JWT_REFRESH_TTL: Joi.string().pattern(DURATION_PATTERN).default('30d'),
  AUTH_THROTTLE_LIMIT: Joi.number().integer().min(1).default(10),
  AUTH_THROTTLE_TTL: Joi.string().pattern(DURATION_PATTERN).default('60s'),
  ARGON2_MEMORY_COST: Joi.number().integer().min(1024).default(65536),
  ARGON2_TIME_COST: Joi.number().integer().min(1).default(3),
  ARGON2_PARALLELISM: Joi.number().integer().min(1).default(4),
  APP_URL: Joi.string()
    .uri()
    .when('NODE_ENV', {
      ...isProduction,
      then: Joi.required(),
      otherwise: Joi.string().uri().default('http://localhost:1420'),
    }),
  // Production must send real mail: the `log` transport only keeps messages in memory.
  MAIL_TRANSPORT: Joi.string().when('NODE_ENV', {
    is: 'production',
    then: Joi.string().valid('smtp').required().messages({
      'any.only': 'MAIL_TRANSPORT must be smtp in production',
      'any.required': 'MAIL_TRANSPORT must be smtp in production',
    }),
    otherwise: Joi.string().valid('log', 'smtp').default('log'),
  }),
  MAIL_FROM: Joi.string().when('NODE_ENV', {
    is: 'production',
    then: Joi.string().required(),
    otherwise: Joi.string().default('Agent <no-reply@localhost>'),
  }),
  SMTP_HOST: Joi.string().when('MAIL_TRANSPORT', { is: 'smtp', then: Joi.required() }),
  SMTP_PORT: Joi.number().port().default(587),
  SMTP_SECURE: Joi.boolean().default(false),
  SMTP_USER: Joi.string().allow('').optional(),
  SMTP_PASS: Joi.string().allow('').optional(),
  // False (default): plan limits are not enforced and the plan UI is hidden.
  BILLING_LIMITS_ENABLED: Joi.boolean().default(false),
  // Stripe is only wired (and its keys required) when billing is switched on.
  BILLING_PROVIDER: Joi.string().valid('none', 'stripe').default('none'),
  STRIPE_SECRET_KEY: stripeSetting,
  STRIPE_WEBHOOK_SECRET: stripeSetting,
  STRIPE_PRICE_PRO: stripeSetting,
  STRIPE_PRICE_TEAM: stripeSetting,
  SEED_PASSWORD: Joi.string().min(8).optional(),
  AGENT_SIMULATOR: Joi.boolean()
    .default(false)
    .when('NODE_ENV', {
      ...isProduction,
      then: Joi.valid(false).messages({
        'any.only': 'AGENT_SIMULATOR must be false in production (it fakes computers and agents)',
      }),
    }),
  RECONCILE_ENABLED: Joi.boolean().default(true),
  SSE_HEARTBEAT_MS: Joi.number().integer().min(50).default(25000),

  DB_HOST: Joi.string().default('localhost'),
  DB_PORT: Joi.number().port().default(5432),
  DB_USERNAME: Joi.string().required(),
  DB_PASSWORD: Joi.string().when('NODE_ENV', {
    ...isProduction,
    then: Joi.string().min(1).required().messages({
      'string.empty': 'DB_PASSWORD must not be empty in production',
    }),
    otherwise: Joi.string().allow('').required(),
  }),
  DB_NAME: Joi.string().required(),
  DB_LOGGING: Joi.boolean().default(false),
  DB_SYNCHRONIZE: Joi.boolean()
    .default(false)
    .when('NODE_ENV', {
      is: 'production',
      then: Joi.valid(false).messages({
        'any.only': 'DB_SYNCHRONIZE must be false in production, use migrations instead',
      }),
    }),
});
