import { ConfigType, registerAs } from '@nestjs/config';
import { DEFAULT_CORS_ORIGINS } from '../contacts';

const DEV_ONLY_ORIGIN = 'http://localhost:1420';

const splitList = (value: string | undefined): string[] =>
  (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

export const appConfig = registerAs('app', () => {
  const corsOrigins = splitList(process.env.CORS_ORIGINS);
  const isProduction = process.env.NODE_ENV === 'production';
  // The Vite dev origin is only a default outside production.
  const defaultOrigins = isProduction
    ? DEFAULT_CORS_ORIGINS.filter((origin) => origin !== DEV_ONLY_ORIGIN)
    : DEFAULT_CORS_ORIGINS;

  return {
    env: process.env.NODE_ENV ?? 'development',
    port: parseInt(process.env.PORT ?? '3000', 10),
    corsOrigins: corsOrigins.length > 0 ? corsOrigins : defaultOrigins,
    swaggerEnabled: process.env.SWAGGER_ENABLED !== 'false',
    sseHeartbeatMs: parseInt(process.env.SSE_HEARTBEAT_MS ?? '25000', 10),
  };
});

export type AppConfig = ConfigType<typeof appConfig>;
