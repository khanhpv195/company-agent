import { DataSource } from 'typeorm';

const KEEP_TABLES = new Set(['migrations', 'typeorm_metadata']);

/**
 * Empties every table in the current schema except TypeORM bookkeeping, resetting
 * sequences. Call in `beforeEach` so each test starts from a clean database.
 */
export const truncateAll = async (dataSource: DataSource): Promise<void> => {
  const rows: { tablename: string }[] = await dataSource.query(
    'SELECT tablename FROM pg_tables WHERE schemaname = current_schema()',
  );
  const tables = rows.map((row) => row.tablename).filter((name) => !KEEP_TABLES.has(name));
  if (tables.length === 0) {
    return;
  }
  const list = tables.map((name) => `"${name.replace(/"/g, '""')}"`).join(', ');
  await dataSource.query(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
};
