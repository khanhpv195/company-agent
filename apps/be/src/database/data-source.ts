import 'reflect-metadata';
import { config } from 'dotenv';
import { extname, join } from 'node:path';
import { DataSource } from 'typeorm';
import { buildDataSourceOptions, databaseConfig } from '../config/database.config';

config({ path: ['.env.local', '.env'], quiet: true });

// `.ts` under ts-node, `.js` from dist/ — never glob both or `.d.ts` files get loaded.
const ext = extname(__filename);

/** Used by the TypeORM CLI (migrations) and the seed runner. */
export default new DataSource({
  ...buildDataSourceOptions(databaseConfig()),
  synchronize: false,
  entities: [join(__dirname, '..', '**', `*.entity${ext}`)],
  migrations: [join(__dirname, 'migrations', `*${ext}`)],
});
