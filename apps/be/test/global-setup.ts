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

export default async function globalSetup(): Promise<void> {
  applyTestEnv();
  await ensureDatabase();
  await runMigrations();
}
