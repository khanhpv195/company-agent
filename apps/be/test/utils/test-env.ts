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
  SWAGGER_ENABLED: 'false',
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
