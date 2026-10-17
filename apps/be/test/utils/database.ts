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
  // A background write left over from the previous test (an in-flight reply, a timer) can
  // deadlock with TRUNCATE's table locks: Postgres aborts one side, so retry the truncate.
  for (let attempt = 1; ; attempt++) {
    try {
      await dataSource.query(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
      return;
    } catch (error) {
      const code = (error as { driverError?: { code?: string } }).driverError?.code;
      if (code !== '40P01' || attempt >= 5) throw error;
      await new Promise((resolve) => setTimeout(resolve, 50 * attempt));
    }
  }
};
