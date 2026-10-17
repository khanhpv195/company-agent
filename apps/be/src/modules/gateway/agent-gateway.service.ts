import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { isUUID } from 'class-validator';
import { DataSource, EntityManager, QueryFailedError } from 'typeorm';
import { ClockService } from '../../common/clock';
import { LEASE_MS } from '../../contacts';
import type { ToolCall } from '@repo/shared';
import { Agent } from '../agents/entities/agent.entity';
import { Computer } from '../computers/entities/computer.entity';
import { EventsService } from '../events';
import {
  Assignment,
  AssignmentSourceKind,
  AssignmentStatus,
  BUSY_STATUSES,
  TASK_WORKING_STATUSES,
  TERMINAL_STATUSES,
} from './entities/assignment.entity';

const CHAT_OPEN_STATUSES: readonly AssignmentStatus[] = [
  'pending',
  'offered',
  'claimed',
  'running',
];
const PG_UNIQUE_VIOLATION = '23505';
/** The newest tool calls kept per assignment, so a row (and its events) stays bounded. */
export const MAX_TOOL_LOG = 200;
export const ONE_TASK_RUN_CONSTRAINT = 'UQ_assignments_one_task_run_per_agent';

export interface CreateAssignmentInput {
  workspaceId: string;
  agentId: string;
  sourceKind: AssignmentSourceKind;
  sourceId: string;
  activation?: string | null;
  /** The requester's language ('vi' | 'en'), when known. */
  lang?: string | null;
  /** The member the run acts for (tools run with their permissions). */
  requestedByMemberId?: string | null;
}

/**
 * `tool`: a tool call. A payload that is a `ToolCall` (has an `id`) is upserted by id into the
 * assignment's `tool_log` and counted once; any other payload just counts. `step` with a
 * `{ turns: number }` payload records the turns taken. `text` is not stored.
 */
export interface ProgressEvent {
  kind: 'tool' | 'text' | 'step';
  payload?: unknown;
}

const asToolCall = (payload: unknown): ToolCall | null => {
  if (!payload || typeof payload !== 'object') return null;
  const call = payload as Partial<ToolCall>;
  return typeof call.id === 'string' && typeof call.name === 'string' ? (call as ToolCall) : null;
};

export interface AssignmentResultInput {
  status: 'completed' | 'failed';
  error?: string | null;
  /** Reported by real daemons; stored on the assignment (`turns` follows `numTurns`). */
  numTurns?: number | null;
  costUsd?: number | null;
}

export type Effect = () => void;

/**
 * Joins a gateway call to the caller's transaction: it runs on `manager` (no new transaction)
 * and its post-commit effects go into `effects`, which the caller fires after its own commit.
 */
export interface GatewayTx {
  manager: EntityManager;
  effects: Effect[];
}

const isOneTaskRunViolation = (error: unknown): boolean => {
  if (!(error instanceof QueryFailedError)) return false;
  const driver = error.driverError as { code?: string; constraint?: string } | undefined;
  return driver?.code === PG_UNIQUE_VIOLATION && driver.constraint === ONE_TASK_RUN_CONSTRAINT;
};

const invalidTransition = (): ConflictException =>
  new ConflictException({ message: 'gateway.INVALID_TRANSITION' });

const isBusy = (status: Assignment['status']): boolean => BUSY_STATUSES.includes(status);
const isTerminal = (status: Assignment['status']): boolean => TERMINAL_STATUSES.includes(status);

/**
 * Daemon protocol for assignments (Kylon style), called in-process for now; HTTP `/gateway/*`
 * comes later. Every transition runs in a transaction holding a row lock, and the realtime /
 * domain events are published only after it commits.
 */
@Injectable()
export class AgentGatewayService {
  private readonly logger = new Logger(AgentGatewayService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly clock: ClockService,
    private readonly events: EventsService,
  ) {}

  async create(input: CreateAssignmentInput, tx?: GatewayTx): Promise<Assignment> {
    const manager = tx?.manager ?? this.dataSource.manager;
    const agent = await manager
      .getRepository(Agent)
      .findOne({ where: { id: input.agentId, workspaceId: input.workspaceId } });
    if (!agent) throw new NotFoundException({ message: 'gateway.AGENT_NOT_FOUND' });
    const saved = await manager.getRepository(Assignment).save(
      manager.getRepository(Assignment).create({
        workspaceId: input.workspaceId,
        agentId: agent.id,
        computerId: agent.computerId,
        sourceKind: input.sourceKind,
        sourceId: input.sourceId,
        activation: input.activation ?? null,
        lang: input.lang ?? null,
        requestedByMemberId: input.requestedByMemberId ?? null,
        status: 'pending',
      }),
    );
    this.afterCommit(tx, () => this.events.publish(saved.workspaceId, { type: 'agents.changed' }));
    return saved;
  }

  /**
   * pending -> offered. A task assignment occupies its agent from here on, so a second one
   * for a busy agent trips the one-task-run index; that is reported as a 409.
   */
  offer(id: string, tx?: GatewayTx): Promise<Assignment> {
    return this.withLock(
      id,
      async (row, manager, effects) => {
        if (row.status !== 'pending') throw invalidTransition();
        row.status = 'offered';
        let saved: Assignment;
        try {
          saved = await manager.save(row);
        } catch (error) {
          if (isOneTaskRunViolation(error)) {
            throw new ConflictException({ message: 'gateway.AGENT_BUSY' });
          }
          throw error;
        }
        effects.push(() => this.events.publish(saved.workspaceId, { type: 'agents.changed' }));
        return saved;
      },
      tx,
    );
  }

  /**
   * Hands the oldest offered assignment on `computerId` (optionally of one agent) to the daemon.
   * Rows an agent cannot take because it already runs a task are skipped, not errors.
   */
  async claim(
    computerId: string,
    agentId?: string,
    sourceKind?: AssignmentSourceKind,
  ): Promise<Assignment | null> {
    const now = this.clock.now();

    const claimed = await this.dataSource.transaction(async (manager) => {
      const skipped: string[] = [];
      for (;;) {
        const query = manager
          .createQueryBuilder(Assignment, 'a')
          .setLock('pessimistic_write')
          .setOnLocked('skip_locked')
          .where('a.computer_id = :computerId AND a.status = :status', {
            computerId,
            status: 'offered',
          });
        // One reply per agent and chat at a time: they share a Claude session, so the next
        // one stays offered until the running one ends.
        query.andWhere(
          `(a.source_kind <> 'chat' OR NOT EXISTS (
             SELECT 1 FROM assignments o
             JOIN messages om ON om.assignment_id = o.id
             JOIN messages m ON m.assignment_id = a.id
             WHERE o.agent_id = a.agent_id AND o.id <> a.id
               AND o.source_kind = 'chat' AND o.status IN ('claimed', 'running')
               AND coalesce(om.parent_id, om.room_id) = coalesce(m.parent_id, m.room_id)))`,
        );
        if (agentId) query.andWhere('a.agent_id = :agentId', { agentId });
        if (sourceKind) query.andWhere('a.source_kind = :sourceKind', { sourceKind });
        if (skipped.length) query.andWhere('a.id NOT IN (:...skipped)', { skipped });
        const row = await query
          .orderBy('a.created_at', 'ASC')
          .addOrderBy('a.id', 'ASC')
          .limit(1)
          .getOne();
        if (!row) return null;

        try {
          // A savepoint: the unique-index violation must not abort the outer transaction.
          await manager.transaction((inner) =>
            inner.update(
              Assignment,
              { id: row.id },
              {
                status: 'claimed',
                attempt: row.attempt + 1,
                leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
              },
            ),
          );
        } catch (error) {
          if (!isOneTaskRunViolation(error)) throw error;
          skipped.push(row.id);
          continue;
        }
        // Read back inside the transaction: the row exactly as this claim wrote it.
        return manager.findOneByOrFail(Assignment, { id: row.id });
      }
    });

    if (!claimed) return null;
    this.events.publish(claimed.workspaceId, { type: 'agents.changed' });
    return claimed;
  }

  /**
   * offered -> claimed for one specific assignment of `computerId` (a chat reply: unlike the
   * oldest-first `claim`, the runner knows exactly which one it is working on).
   */
  claimById(id: string, computerId: string, tx?: GatewayTx): Promise<Assignment> {
    return this.withLock(
      id,
      async (row, manager, effects) => {
        if (row.status !== 'offered' || row.computerId !== computerId) throw invalidTransition();
        row.status = 'claimed';
        row.attempt += 1;
        row.leaseExpiresAt = this.leaseFrom(this.clock.now());
        const saved = await manager.save(row);
        effects.push(() => this.events.publish(saved.workspaceId, { type: 'agents.changed' }));
        return saved;
      },
      tx,
    );
  }

  /** The assignment when it belongs to `computerId`; anything else reads as "not found". */
  async findOwned(id: string, computerId: string, tx?: GatewayTx): Promise<Assignment> {
    const manager = tx?.manager ?? this.dataSource.manager;
    const row = isUUID(id) ? await manager.findOneBy(Assignment, { id }) : null;
    if (!row || row.computerId !== computerId) {
      throw new NotFoundException({ message: 'gateway.NOT_FOUND' });
    }
    return row;
  }

  /** Remembers the conversation key of a claimed assignment (resolved at claim time). */
  async setSessionKey(id: string, key: string): Promise<void> {
    await this.dataSource.getRepository(Assignment).update({ id }, { sessionKey: key });
  }

  /** claimed -> running. */
  accept(id: string, attempt: number): Promise<Assignment> {
    return this.withLock(id, async (row, manager) => {
      this.assertAttempt(row, attempt);
      if (row.status !== 'claimed') throw invalidTransition();
      const now = this.clock.now();
      row.status = 'running';
      row.startedAt = now;
      row.leaseExpiresAt = this.leaseFrom(now);
      return manager.save(row);
    });
  }

  /** Renews the lease while claimed or running. */
  heartbeat(id: string, attempt: number): Promise<Assignment> {
    return this.withLock(id, async (row, manager) => {
      this.assertAttempt(row, attempt);
      if (!isBusy(row.status)) throw invalidTransition();
      row.leaseExpiresAt = this.leaseFrom(this.clock.now());
      return manager.save(row);
    });
  }

  progress(
    id: string,
    attempt: number,
    events: ProgressEvent[],
    tx?: GatewayTx,
  ): Promise<Assignment> {
    return this.withLock(
      id,
      async (row, manager, effects) => {
        this.assertAttempt(row, attempt);
        if (row.status !== 'running') throw invalidTransition();
        for (const event of events) {
          if (event.kind === 'tool') {
            const call = asToolCall(event.payload);
            const at = call ? row.toolLog.findIndex((known) => known.id === call.id) : -1;
            if (call && at >= 0) {
              row.toolLog = row.toolLog.map((known, i) => (i === at ? call : known));
            } else {
              if (call) row.toolLog = [...row.toolLog, call];
              row.toolCalls += 1;
            }
          } else if (event.kind === 'step') {
            const turns = (event.payload as { turns?: unknown } | undefined)?.turns;
            if (typeof turns === 'number' && Number.isInteger(turns) && turns >= 0) {
              row.turns = turns;
            }
          }
        }
        if (row.toolLog.length > MAX_TOOL_LOG) row.toolLog = row.toolLog.slice(-MAX_TOOL_LOG);
        const saved = await manager.save(row);
        effects.push(() =>
          this.events.emitAssignmentProgress({
            workspaceId: saved.workspaceId,
            assignmentId: saved.id,
            agentId: saved.agentId,
            events,
          }),
        );
        return saved;
      },
      tx,
    );
  }

  /** claimed|running -> completed|failed. Repeating the same report is a no-op. */
  result(
    id: string,
    attempt: number,
    input: AssignmentResultInput,
    tx?: GatewayTx,
  ): Promise<Assignment> {
    return this.withLock(
      id,
      async (row, manager, effects) => {
        this.assertAttempt(row, attempt);
        if (isTerminal(row.status)) {
          if (row.status === input.status) return row;
          throw invalidTransition();
        }
        if (!isBusy(row.status)) throw invalidTransition();
        if (input.numTurns != null) {
          row.numTurns = input.numTurns;
          row.turns = input.numTurns;
        }
        if (input.costUsd != null) row.costUsd = input.costUsd;
        return this.finish(row, manager, effects, input.status, input.error ?? null);
      },
      tx,
    );
  }

  /** Any non-terminal assignment -> cancelled. */
  cancel(id: string, tx?: GatewayTx): Promise<Assignment> {
    return this.withLock(
      id,
      async (row, manager, effects) => {
        if (isTerminal(row.status)) throw invalidTransition();
        return this.finish(row, manager, effects, 'cancelled', null);
      },
      tx,
    );
  }

  /** Any non-terminal assignment -> expired, with the reason (e.g. no computer to take it). */
  expire(id: string, error: string, tx?: GatewayTx): Promise<Assignment> {
    return this.withLock(
      id,
      async (row, manager, effects) => {
        if (isTerminal(row.status)) throw invalidTransition();
        return this.finish(row, manager, effects, 'expired', error);
      },
      tx,
    );
  }

  /** Expires claimed/running assignments whose lease ran out. Returns how many expired. */
  async reconcileLeases(now: Date): Promise<number> {
    const stale = await this.dataSource
      .getRepository(Assignment)
      .createQueryBuilder('a')
      .select('a.id', 'id')
      .where('a.status IN (:...busy) AND a.lease_expires_at < :now', {
        busy: [...BUSY_STATUSES],
        now,
      })
      .getRawMany<{ id: string }>();

    let expired = 0;
    for (const { id } of stale) {
      try {
        await this.withLock(id, async (row, manager, effects) => {
          // Re-checked under the lock: the daemon may have renewed or finished meanwhile.
          if (!isBusy(row.status) || !row.leaseExpiresAt || row.leaseExpiresAt >= now) return row;
          expired += 1;
          return this.finish(row, manager, effects, 'expired', null);
        });
      } catch (error) {
        if (error instanceof NotFoundException) continue;
        this.logger.error(
          `Lease reconcile failed for assignment ${id}`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }
    return expired;
  }

  /**
   * Expires task assignments (offered, claimed or running) whose computer is not online: the
   * runner cannot pick an offer up, so the engine finalizes the run as expired and the task goes
   * back to todo. Chat assignments are left to the chat module. Returns how many expired.
   */
  async expireOfflineTaskAssignments(): Promise<number> {
    const stranded = await this.dataSource
      .getRepository(Assignment)
      .createQueryBuilder('a')
      .innerJoin(Computer, 'c', 'c.id = a.computer_id')
      .select('a.id', 'id')
      .where(`a.source_kind = 'task' AND a.status IN (:...working) AND c.status <> 'online'`, {
        working: [...TASK_WORKING_STATUSES],
      })
      .getRawMany<{ id: string }>();

    let expired = 0;
    for (const { id } of stranded) {
      try {
        await this.withLock(id, async (row, manager, effects) => {
          if (!TASK_WORKING_STATUSES.includes(row.status)) return row;
          // Re-checked under the lock: the computer may have come back meanwhile.
          const computer = await manager.findOneBy(Computer, { id: row.computerId });
          if (computer?.status === 'online') return row;
          expired += 1;
          return this.finish(row, manager, effects, 'expired', null);
        });
      } catch (error) {
        if (error instanceof NotFoundException) continue;
        this.logger.error(
          `Offline expiry failed for assignment ${id}`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }
    return expired;
  }

  /**
   * Expires chat assignments (pending through running) whose computer is not online: nobody can
   * pick the reply up, so it ends as expired with a readable reason and ChatService fails the
   * message. Safe next to the simulator's own 1.2 s expiry: whoever locks second sees a
   * terminal row and does nothing. Returns how many expired.
   */
  async expireOfflineChatAssignments(): Promise<number> {
    const stranded = await this.dataSource
      .getRepository(Assignment)
      .createQueryBuilder('a')
      .innerJoin(Computer, 'c', 'c.id = a.computer_id')
      .select('a.id', 'id')
      .where(`a.source_kind = 'chat' AND a.status IN (:...open) AND c.status <> 'online'`, {
        open: [...CHAT_OPEN_STATUSES],
      })
      .getRawMany<{ id: string }>();

    let expired = 0;
    for (const { id } of stranded) {
      try {
        await this.withLock(id, async (row, manager, effects) => {
          if (!CHAT_OPEN_STATUSES.includes(row.status)) return row;
          // Re-checked under the lock: the computer may have come back meanwhile.
          const computer = await manager.findOneBy(Computer, { id: row.computerId });
          if (!computer || computer.status === 'online') return row;
          expired += 1;
          return this.finish(
            row,
            manager,
            effects,
            'expired',
            `${computer.name} offline, không có máy nhận việc`,
          );
        });
      } catch (error) {
        if (error instanceof NotFoundException || error instanceof ConflictException) continue;
        this.logger.error(
          `Offline expiry failed for chat assignment ${id}`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }
    return expired;
  }

  private leaseFrom(now: Date): Date {
    return new Date(now.getTime() + LEASE_MS);
  }

  private assertAttempt(row: Assignment, attempt: number): void {
    if (row.attempt !== attempt) throw invalidTransition();
  }

  private async finish(
    row: Assignment,
    manager: EntityManager,
    effects: Effect[],
    status: 'completed' | 'failed' | 'expired' | 'cancelled',
    error: string | null,
  ): Promise<Assignment> {
    // An offered task run already counted the agent as working.
    const wasWorking =
      isBusy(row.status) || (row.status === 'offered' && row.sourceKind === 'task');
    row.status = status;
    row.error = error;
    row.endedAt = this.clock.now();
    row.leaseExpiresAt = null;
    const saved = await manager.save(row);
    effects.push(() => {
      this.events.emitAssignmentEnded({
        workspaceId: saved.workspaceId,
        assignmentId: saved.id,
        sourceKind: saved.sourceKind,
        sourceId: saved.sourceId,
        agentId: saved.agentId,
        status: saved.status,
      });
      if (wasWorking) this.events.publish(saved.workspaceId, { type: 'agents.changed' });
    });
    return saved;
  }

  private afterCommit(tx: GatewayTx | undefined, effect: Effect): void {
    if (tx) tx.effects.push(effect);
    else this.fire([effect], 'assignment');
  }

  private fire(effects: Effect[], what: string): void {
    for (const effect of effects) {
      try {
        effect();
      } catch (error) {
        this.logger.error(
          `Post-commit effect failed for ${what}`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }
  }

  /**
   * Row-locks the assignment and applies `apply`. Alone it opens its own transaction and fires
   * the effects after commit; with `tx` it joins the caller's transaction and hands the effects over.
   */
  private async withLock(
    id: string,
    apply: (row: Assignment, manager: EntityManager, effects: Effect[]) => Promise<Assignment>,
    tx?: GatewayTx,
  ): Promise<Assignment> {
    const run = async (manager: EntityManager, effects: Effect[]): Promise<Assignment> => {
      const row = await manager.findOne(Assignment, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!row) throw new NotFoundException({ message: 'gateway.NOT_FOUND' });
      return apply(row, manager, effects);
    };
    if (tx) return run(tx.manager, tx.effects);

    const effects: Effect[] = [];
    const result = await this.dataSource.transaction((manager) => run(manager, effects));
    this.fire(effects, `assignment ${id}`);
    return result;
  }
}
