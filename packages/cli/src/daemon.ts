import { ApiError, type GatewayClient } from './api.js';
import { errorMessage, type Logger } from './log.js';
import { ABORT_CANCELLED, ABORT_SHUTDOWN, runAssignment, type RunnerDeps } from './runner.js';
import type { GatewayAgent, GatewayAssignment } from './types.js';

export interface DaemonOptions extends RunnerDeps {
  cliVersion: string;
  maxChats: number;
  heartbeatMs?: number;
  claimMs?: number;
  /** Ceiling for the retry delay while the server is unreachable. */
  maxBackoffMs?: number;
  /** Called when the server rejects our key (computer revoked). */
  onFatal?: (reason: string) => void;
}

/** Capped exponential backoff: `base * 2^(failures-1)`, reset by `ok()`. */
export class Backoff {
  private failures = 0;
  private nextAt = 0;

  constructor(
    private readonly baseMs: number,
    private readonly maxMs: number,
  ) {}

  ready(now = Date.now()): boolean {
    return now >= this.nextAt;
  }

  /** Records a failure and returns the delay before the next attempt. */
  fail(now = Date.now()): number {
    this.failures += 1;
    const delay = Math.min(this.maxMs, this.baseMs * 2 ** (this.failures - 1));
    this.nextAt = now + delay;
    return delay;
  }

  /** Records a success; returns how many failures it ended. */
  ok(): number {
    const was = this.failures;
    this.failures = 0;
    this.nextAt = 0;
    return was;
  }
}

/** Lets a repeating warning through at most once per `everyMs`. */
class RateLimited {
  private last = 0;
  constructor(private readonly everyMs: number) {}
  allow(now = Date.now()): boolean {
    if (now - this.last < this.everyMs) return false;
    this.last = now;
    return true;
  }
}

interface ActiveRun {
  assignment: GatewayAssignment;
  abort: AbortController;
  done: Promise<void>;
}

export class Daemon {
  readonly active = new Map<string, ActiveRun>();
  agents: GatewayAgent[] = [];
  private timers: NodeJS.Timeout[] = [];
  private stopping = false;
  private claiming = false;
  private heartbeating = false;
  private claimLoop: Promise<number> | null = null;
  private readonly log: Logger;
  private readonly hbBackoff: Backoff;
  private readonly claimBackoff: Backoff;
  private readonly hbWarn = new RateLimited(30_000);
  private readonly claimWarn = new RateLimited(30_000);

  constructor(private readonly opts: DaemonOptions) {
    this.log = opts.log;
    const max = opts.maxBackoffMs ?? 60_000;
    this.hbBackoff = new Backoff(opts.heartbeatMs ?? 5000, max);
    this.claimBackoff = new Backoff(opts.claimMs ?? 2000, max);
  }

  private get client(): GatewayClient {
    return this.opts.client;
  }

  runningChats(): number {
    return [...this.active.values()].filter((r) => r.assignment.kind === 'chat').length;
  }

  private busyTaskAgents(): Set<string> {
    return new Set(
      [...this.active.values()]
        .filter((r) => r.assignment.kind === 'task')
        .map((r) => r.assignment.agent.id),
    );
  }

  /** Chat slots left, and whether any agent could take a task run. */
  capacity(): { chatSlots: number; taskSlots: number } {
    const busy = this.busyTaskAgents();
    return {
      chatSlots: Math.max(0, this.opts.maxChats - this.runningChats()),
      taskSlots: this.agents.filter((a) => !busy.has(a.id)).length,
    };
  }

  private fatal(err: unknown): boolean {
    if (err instanceof ApiError && err.status === 401) {
      this.opts.onFatal?.(
        `Server rejected the API key (${err.message}). Run "agent connect" again.`,
      );
      return true;
    }
    return false;
  }

  async heartbeatOnce(): Promise<void> {
    if (this.heartbeating) return; // previous request still in flight
    this.heartbeating = true;
    try {
      const res = await this.client.heartbeat(this.opts.cliVersion, [...this.active.keys()]);
      this.agents = res.agents ?? [];
      for (const id of res.cancelled ?? []) {
        const run = this.active.get(id);
        if (run && !run.abort.signal.aborted) run.abort.abort(ABORT_CANCELLED);
      }
      if (this.hbBackoff.ok() > 0) this.log('info', 'server reachable again (heartbeat)');
    } catch (err) {
      if (this.fatal(err)) return;
      const delay = this.hbBackoff.fail();
      if (this.hbWarn.allow()) {
        this.log('warn', `heartbeat failed: ${errorMessage(err)} (retrying in ${delay} ms)`);
      }
    } finally {
      this.heartbeating = false;
    }
  }

  /** Claims while capacity allows; returns how many assignments were started. */
  claimOnce(): Promise<number> {
    if (this.stopping || this.claiming) return Promise.resolve(0);
    this.claiming = true;
    const loop = this.claimUntilFull().finally(() => {
      this.claiming = false;
      this.claimLoop = null;
    });
    this.claimLoop = loop;
    return loop;
  }

  private async claimUntilFull(): Promise<number> {
    let started = 0;
    while (!this.stopping) {
      const { chatSlots, taskSlots } = this.capacity();
      if (chatSlots === 0 && taskSlots === 0) break;
      let assignment: GatewayAssignment | null;
      try {
        assignment = await this.client.claim(chatSlots);
        if (this.claimBackoff.ok() > 0) this.log('info', 'server reachable again (claim)');
      } catch (err) {
        if (this.fatal(err)) break;
        const delay = this.claimBackoff.fail();
        if (this.claimWarn.allow()) {
          this.log('warn', `claim failed: ${errorMessage(err)} (retrying in ${delay} ms)`);
        }
        break;
      }
      if (!assignment) break;
      this.start(assignment);
      started += 1;
    }
    return started;
  }

  private start(assignment: GatewayAssignment): void {
    const abort = new AbortController();
    // Shutdown began while the claim request was in flight. Never start the agent: the run is
    // pre-aborted, so runAssignment accepts it and reports `failed: daemon stopped` at once
    // (the server frees it now instead of waiting for the lease to expire).
    if (this.stopping) abort.abort(ABORT_SHUTDOWN);
    this.log('info', `claimed ${assignment.kind} ${assignment.id} for ${assignment.agent.name}`);
    const done = runAssignment(assignment, this.opts, abort)
      .catch((err) => this.log('error', `run ${assignment.id} crashed: ${errorMessage(err)}`))
      .finally(() => this.active.delete(assignment.id));
    this.active.set(assignment.id, { assignment, abort, done });
  }

  async run(): Promise<void> {
    await this.heartbeatOnce();
    this.timers.push(
      setInterval(() => {
        if (this.hbBackoff.ready()) void this.heartbeatOnce();
      }, this.opts.heartbeatMs ?? 5000),
      setInterval(() => {
        if (this.claimBackoff.ready()) void this.claimOnce();
      }, this.opts.claimMs ?? 2000),
    );
    void this.claimOnce();
  }

  /** Abort every run (each reports `failed: daemon stopped`) and wait for them. */
  async shutdown(graceMs = 10_000): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    let timer: NodeJS.Timeout | undefined;
    const grace = new Promise((resolve) => {
      timer = setTimeout(resolve, graceMs);
    });
    // let an in-flight claim land first (it is started pre-aborted, see start())
    if (this.claimLoop) await Promise.race([this.claimLoop.catch(() => 0), grace]);
    const runs = [...this.active.values()];
    for (const r of runs) r.abort.abort(ABORT_SHUTDOWN);
    await Promise.race([Promise.allSettled(runs.map((r) => r.done)), grace]);
    clearTimeout(timer);
  }
}
