import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import type { Effect } from '../gateway/agent-gateway.service';

/** The workspace was deleted while the command waited: HTTP callers see a 404, system callers skip. */
export class WorkspaceGoneException extends NotFoundException {
  constructor() {
    super({ message: 'workspace.NOT_FOUND' });
  }
}

/**
 * Serialises every task command of a workspace: an in-process promise chain, plus one
 * transaction holding `pg_advisory_xact_lock` (so a second API instance waits as well).
 * Effects the command collected (events, timers) fire only after the commit, still inside
 * the chain, so they are never published for a rolled-back command.
 */
@Injectable()
export class WorkspaceLockService {
  private readonly logger = new Logger(WorkspaceLockService.name);
  private readonly chains = new Map<string, Promise<void>>();

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  run<T>(
    workspaceId: string,
    fn: (manager: EntityManager, effects: Effect[]) => Promise<T>,
  ): Promise<T> {
    const previous = this.chains.get(workspaceId) ?? Promise.resolve();
    const result = previous.then(async () => {
      const effects: Effect[] = [];
      const value = await this.dataSource.transaction(async (manager) => {
        await manager.query('SELECT pg_advisory_xact_lock(hashtext($1::text))', [workspaceId]);
        // Deleting a workspace takes this same lock, so a queued command can find it gone.
        const alive = await manager.query('SELECT 1 FROM workspaces WHERE id = $1', [workspaceId]);
        if (!Array.isArray(alive) || alive.length === 0) throw new WorkspaceGoneException();
        return fn(manager, effects);
      });
      for (const effect of effects) {
        try {
          effect();
        } catch (error) {
          this.logger.error(
            `Post-commit effect failed for workspace ${workspaceId}`,
            error instanceof Error ? error.stack : String(error),
          );
        }
      }
      return value;
    });
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.chains.set(workspaceId, tail);
    void tail.then(() => {
      if (this.chains.get(workspaceId) === tail) this.chains.delete(workspaceId);
    });
    return result;
  }

  /** Resolves once every command queued so far (and any queued meanwhile) has finished. */
  async idle(): Promise<void> {
    while (this.chains.size) await Promise.all([...this.chains.values()]);
  }
}
