import { Logger } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import dataSource from '../data-source';

type Seeder = (ds: DataSource) => Promise<void>;

// Later phases (auth, agents, tasks...) register their seeders here, in run order.
const seeders: Seeder[] = [];

const logger = new Logger('Seed');

const run = async (): Promise<void> => {
  if (seeders.length === 0) {
    logger.log('No seeders registered, skipping');
    return;
  }
  await dataSource.initialize();
  try {
    for (const seed of seeders) {
      await seed(dataSource);
    }
    logger.log(`Ran ${seeders.length} seeder(s)`);
  } finally {
    await dataSource.destroy();
  }
};

run().catch((error: unknown) => {
  logger.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
