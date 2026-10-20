/**
 * Environment for the e2e suite. Shared by the jest `setupFiles` (each test file)
 * and `globalSetup` (create + migrate the database once).
 *
 * The forced values always win over the shell and `apps/be/.env`: @nestjs/config
 * merges `{ ...envFile, ...process.env }`, so anything set here beats the env file.
 * Connection settings only default, so CI can point DB_HOST/DB_PORT elsewhere.
 */
export const TEST_DB_NAME = 'agent_test';

const FORCED: Record<string, string> = {
  NODE_ENV: 'test',
  DB_NAME: TEST_DB_NAME,
  DB_SYNCHRONIZE: 'false',
  DB_LOGGING: 'false',
  JWT_ACCESS_SECRET: 'e2e-test-access-secret-0123456789abcdef',
  AGENT_SIMULATOR: 'false',
  AUTH_THROTTLE_LIMIT: '1000',
  // Cheap argon2: the default (64 MiB x 3) costs 150-700 ms per hash and starves under load.
  ARGON2_MEMORY_COST: '4096',
  ARGON2_TIME_COST: '2',
  ARGON2_PARALLELISM: '1',
  RECONCILE_ENABLED: 'false',
  RETENTION_ENABLED: 'false',
  // Specs hammer endpoints: the global limits stay out of the way unless a spec lowers them.
  API_THROTTLE_LIMIT: '100000',
  GATEWAY_THROTTLE_LIMIT: '100000',
  LOG_LEVEL: 'silent',
  CONNECTIONS_MODE: 'simulated',
  SWAGGER_ENABLED: 'false',
  // Limit specs rely on enforcement; billing-limits-off.e2e-spec.ts overrides it.
  BILLING_LIMITS_ENABLED: 'true',
};

const DEFAULTS: Record<string, string> = {
  DB_HOST: 'localhost',
  DB_PORT: '5432',
  DB_USERNAME: 'postgres',
  DB_PASSWORD: 'postgres',
};

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'postgres']);

/** The suite creates/migrates/truncates a database, so refuse non-local hosts by default. */
const assertSafeHost = (): void => {
  const host = process.env.DB_HOST ?? '';
  if (!LOCAL_HOSTS.has(host) && process.env.E2E_ALLOW_REMOTE_DB !== 'true') {
    throw new Error(
      `e2e: refusing to run against DB_HOST="${host}". Use localhost/127.0.0.1/::1/postgres, ` +
        'or set E2E_ALLOW_REMOTE_DB=true if you really mean it.',
    );
  }
};

export const applyTestEnv = (): void => {
  for (const [key, value] of Object.entries(DEFAULTS)) {
    process.env[key] ??= value;
  }
  Object.assign(process.env, FORCED);
  assertSafeHost();
};
