import type { DataSource } from 'typeorm';

/** Releases the run lock taken in global-setup.ts (closing its connection drops the lock). */
export default async function globalTeardown(): Promise<void> {
  const holder = globalThis as { __e2eLock?: DataSource };
  await holder.__e2eLock?.destroy();
  holder.__e2eLock = undefined;
}
