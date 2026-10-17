import type { DataSource, EntityManager } from 'typeorm';
import { WorkspaceLockService } from './workspace-lock.service';

const manager = { query: jest.fn().mockResolvedValue([]) } as unknown as EntityManager;
let transactions = 0;
let rollback = false;
const dataSource = {
  transaction: async (fn: (m: EntityManager) => Promise<unknown>) => {
    transactions += 1;
    const result = await fn(manager);
    if (rollback) throw new Error('rolled back');
    return result;
  },
} as unknown as DataSource;

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

describe('WorkspaceLockService', () => {
  let lock: WorkspaceLockService;

  beforeEach(() => {
    transactions = 0;
    rollback = false;
    lock = new WorkspaceLockService(dataSource);
  });

  it('runs commands of one workspace one after the other, in call order', async () => {
    const order: string[] = [];
    const slow = lock.run('w1', async () => {
      order.push('a:start');
      await tick();
      order.push('a:end');
    });
    const fast = lock.run('w1', async () => {
      order.push('b:start');
      order.push('b:end');
    });
    await Promise.all([slow, fast]);
    expect(order).toEqual(['a:start', 'a:end', 'b:start', 'b:end']);
    expect(transactions).toBe(2);
  });

  it('does not make different workspaces wait for each other', async () => {
    const order: string[] = [];
    const slow = lock.run('w1', async () => {
      await tick();
      order.push('w1');
    });
    const other = lock.run('w2', async () => {
      order.push('w2');
    });
    await Promise.all([slow, other]);
    expect(order).toEqual(['w2', 'w1']);
  });

  it('fires effects after the commit, in order, before the next command starts', async () => {
    const order: string[] = [];
    const first = lock.run('w1', async (_m, effects) => {
      effects.push(
        () => order.push('effect-1'),
        () => order.push('effect-2'),
      );
      order.push('body');
    });
    const second = lock.run('w1', async () => {
      order.push('next');
    });
    await Promise.all([first, second]);
    expect(order).toEqual(['body', 'effect-1', 'effect-2', 'next']);
  });

  it('drops the effects of a rolled-back command and keeps the chain alive', async () => {
    const effect = jest.fn();
    rollback = true;
    await expect(
      lock.run('w1', async (_m, effects) => {
        effects.push(effect);
      }),
    ).rejects.toThrow('rolled back');
    rollback = false;
    expect(effect).not.toHaveBeenCalled();
    await expect(lock.run('w1', async () => 'still works')).resolves.toBe('still works');
  });

  it('survives a throwing effect', async () => {
    const after = jest.fn();
    await lock.run('w1', async (_m, effects) => {
      effects.push(() => {
        throw new Error('listener');
      }, after);
    });
    expect(after).toHaveBeenCalled();
  });

  it('idle resolves once the queue drained', async () => {
    let done = false;
    void lock.run('w1', async () => {
      await tick();
      done = true;
    });
    await lock.idle();
    expect(done).toBe(true);
  });
});
