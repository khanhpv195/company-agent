import { SupportedLanguage } from '@repo/shared';
import * as Joi from 'joi';
import { DEFAULT_CORS_ORIGINS } from '../contacts';

/** `<number>[s|m|h|d]`, see `parseDuration`. */
const DURATION_PATTERN = /^\d+[smhd]$/;

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  PORT: Joi.number().port().default(3000),
  CORS_ORIGINS: Joi.string().default(DEFAULT_CORS_ORIGINS.join(',')),
  SWAGGER_ENABLED: Joi.boolean().default(true),
  FALLBACK_LANGUAGE: Joi.string()
    .valid(...Object.values(SupportedLanguage))
    .default(SupportedLanguage.EN),

  JWT_ACCESS_SECRET: Joi.string().min(32).required(),
  JWT_ACCESS_TTL: Joi.string().pattern(DURATION_PATTERN).default('15m'),
  JWT_REFRESH_TTL: Joi.string().pattern(DURATION_PATTERN).default('30d'),
  AUTH_THROTTLE_LIMIT: Joi.number().integer().min(1).default(10),
  AUTH_THROTTLE_TTL: Joi.string().pattern(DURATION_PATTERN).default('60s'),
  ARGON2_MEMORY_COST: Joi.number().integer().min(1024).default(65536),
  ARGON2_TIME_COST: Joi.number().integer().min(1).default(3),
  ARGON2_PARALLELISM: Joi.number().integer().min(1).default(4),
  SEED_PASSWORD: Joi.string().min(8).optional(),
  AGENT_SIMULATOR: Joi.boolean().default(false),
  RECONCILE_ENABLED: Joi.boolean().default(true),
  SSE_HEARTBEAT_MS: Joi.number().integer().min(50).default(25000),

  DB_HOST: Joi.string().default('localhost'),
  DB_PORT: Joi.number().port().default(5432),
  DB_USERNAME: Joi.string().required(),
  DB_PASSWORD: Joi.string().allow('').required(),
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
