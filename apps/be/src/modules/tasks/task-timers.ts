import { Injectable, OnModuleDestroy } from '@nestjs/common';

/** Deferred work (agent pick-up, replies). Tests replace it with a manual queue. */
@Injectable()
export class TaskTimers implements OnModuleDestroy {
  private readonly handles = new Set<NodeJS.Timeout>();

  later(ms: number, fn: () => void): void {
    const handle = setTimeout(() => {
      this.handles.delete(handle);
      fn();
    }, ms);
    handle.unref();
    this.handles.add(handle);
  }

  onModuleDestroy(): void {
    for (const handle of this.handles) clearTimeout(handle);
    this.handles.clear();
  }
}

/** Source of randomness for the engine (run failures, which running task advances). */
@Injectable()
export class Random {
  next(): number {
    return Math.random();
  }
}
