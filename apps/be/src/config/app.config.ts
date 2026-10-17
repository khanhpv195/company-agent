import { ConfigType, registerAs } from '@nestjs/config';
import { DEFAULT_CORS_ORIGINS } from '../contacts';

const DEV_ONLY_ORIGIN = 'http://localhost:1420';

const splitList = (value: string | undefined): string[] =>
  (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

/** `TRUST_PROXY`: `true`, a hop count (`1`) or anything else = off (Express `trust proxy`). */
export const parseTrustProxy = (value: string | undefined): boolean | number => {
  const raw = (value ?? '').trim().toLowerCase();
  if (raw === 'true') return true;
  return /^\d+$/.test(raw) && Number(raw) > 0 ? Number(raw) : false;
};

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
    // Off by default in production, on elsewhere; SWAGGER_ENABLED overrides either way.
    swaggerEnabled: (process.env.SWAGGER_ENABLED ?? (isProduction ? 'false' : 'true')) !== 'false',
    appUrl: (process.env.APP_URL ?? 'http://localhost:1420').replace(/\/+$/, ''),
    trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
    sseHeartbeatMs: parseInt(process.env.SSE_HEARTBEAT_MS ?? '25000', 10),
  };
});

export type AppConfig = ConfigType<typeof appConfig>;
