import { Logger } from '@nestjs/common';
import dataSource from '../data-source';
import { seedTodos } from './todos.seed';

const logger = new Logger('Seed');

const run = async (): Promise<void> => {
  await dataSource.initialize();
  try {
    const inserted = await seedTodos(dataSource);
    logger.log(inserted > 0 ? `Inserted ${inserted} todos` : 'Todos already seeded, skipping');
  } finally {
    await dataSource.destroy();
  }
};

run().catch((error: unknown) => {
  logger.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
