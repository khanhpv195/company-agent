import { Logger } from '@nestjs/common';
import type { DataSource, EntityManager } from 'typeorm';

/** Work to run after a transaction commits (publishing events, scheduling timers). */
export type AfterCommit = () => void;

const logger = new Logger('Transaction');

/**
 * Runs `fn` in a transaction and fires the effects it collected only after the commit, so
 * nothing is published for a rolled-back write. A throwing effect is logged, never rethrown.
 */
export const transactionWithEffects = async <T>(
  dataSource: DataSource,
  fn: (manager: EntityManager, effects: AfterCommit[]) => Promise<T>,
): Promise<T> => {
  const effects: AfterCommit[] = [];
  const result = await dataSource.transaction((manager) => fn(manager, effects));
  for (const effect of effects) {
    try {
      effect();
    } catch (error) {
      logger.error(
        'Post-commit effect failed',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
  return result;
};
