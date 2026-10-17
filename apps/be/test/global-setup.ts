import 'reflect-metadata';
import { join } from 'node:path';
import { DataSource } from 'typeorm';
import { buildDataSourceOptions, databaseConfig } from '../src/config/database.config';
import { applyTestEnv, TEST_DB_NAME } from './utils/test-env';

/** Creates the e2e database when missing (existing docker volumes skip init scripts). */
const ensureDatabase = async (): Promise<void> => {
  const admin = new DataSource({
    ...buildDataSourceOptions(databaseConfig()),
    database: 'postgres',
    synchronize: false,
  });
  try {
    await admin.initialize();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `e2e: cannot reach Postgres at ${process.env.DB_HOST}:${process.env.DB_PORT} (${reason}). ` +
        'Start it with `docker compose up -d postgres` from the repo root.',
      { cause: error },
    );
  }
  try {
    const rows: unknown[] = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      TEST_DB_NAME,
    ]);
    if (rows.length === 0) {
      await admin.query(`CREATE DATABASE "${TEST_DB_NAME}"`);
    }
  } finally {
    await admin.destroy();
  }
};

const runMigrations = async (): Promise<void> => {
  const dataSource = new DataSource({
    ...buildDataSourceOptions(databaseConfig()),
    synchronize: false,
    migrations: [join(__dirname, '..', 'src', 'database', 'migrations', '*.ts')],
  });
  await dataSource.initialize();
  try {
    await dataSource.runMigrations({ transaction: 'each' });
  } finally {
    await dataSource.destroy();
  }
};

/**
 * Two e2e runs against the same database corrupt each other (shared tables, global sweeps such as
 * failStaleReplies), so a session-level advisory lock on a dedicated connection serialises them.
 * global-teardown.ts releases it (the connection also drops it if this process dies).
 */
const LOCK_KEY = 7_349_120_001;
const acquireRunLock = async (): Promise<void> => {
  const source = new DataSource({
    ...buildDataSourceOptions(databaseConfig()),
    database: 'postgres',
    synchronize: false,
  });
  await source.initialize();
  const runner = source.createQueryRunner(); // one dedicated connection holds the session lock
  await runner.connect();
  const rows: Array<{ ok: boolean }> = await runner.query('SELECT pg_try_advisory_lock($1) AS ok', [
    LOCK_KEY,
  ]);
  if (!rows[0]?.ok) {
    await source.destroy();
    throw new Error(
      'e2e: another e2e run is already using the test database (advisory lock held). ' +
        'Wait for it to finish and run again.',
    );
  }
  (globalThis as { __e2eLock?: DataSource }).__e2eLock = source;
};

export default async function globalSetup(): Promise<void> {
  applyTestEnv();
  await ensureDatabase();
  await acquireRunLock();
  await ensureDatabase();
  await runMigrations();
}
