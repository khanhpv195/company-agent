import { SupportedLanguage } from '@repo/shared';
import * as Joi from 'joi';
import { DEFAULT_CORS_ORIGINS } from '../contacts';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  PORT: Joi.number().port().default(3000),
  CORS_ORIGINS: Joi.string().default(DEFAULT_CORS_ORIGINS.join(',')),
  SWAGGER_ENABLED: Joi.boolean().default(true),
  FALLBACK_LANGUAGE: Joi.string()
    .valid(...Object.values(SupportedLanguage))
    .default(SupportedLanguage.EN),

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
