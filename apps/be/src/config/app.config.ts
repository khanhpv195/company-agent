import { ConfigType, registerAs } from '@nestjs/config';
import { DEFAULT_CORS_ORIGINS } from '../contacts';

const splitList = (value: string | undefined): string[] =>
  (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

export const appConfig = registerAs('app', () => {
  const corsOrigins = splitList(process.env.CORS_ORIGINS);

  return {
    env: process.env.NODE_ENV ?? 'development',
    port: parseInt(process.env.PORT ?? '3000', 10),
    corsOrigins: corsOrigins.length > 0 ? corsOrigins : DEFAULT_CORS_ORIGINS,
    swaggerEnabled: process.env.SWAGGER_ENABLED !== 'false',
  };
});

export type AppConfig = ConfigType<typeof appConfig>;
