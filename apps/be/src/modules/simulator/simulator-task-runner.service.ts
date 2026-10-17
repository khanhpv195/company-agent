import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { agentConfig } from '../../config';
import { SIMULATOR_TASK_TICK_MS } from '../../contacts';
import { Computer } from '../computers/entities/computer.entity';
import { AgentGatewayService } from '../gateway/agent-gateway.service';
import { Assignment } from '../gateway/entities/assignment.entity';
import type { AgentRunner } from '../tasks/agent-runner';
import { TaskEngineService } from '../tasks/task-engine.service';

/**
 * Stands in for the daemon of every `simulated` computer (only with AGENT_SIMULATOR): claims
 * and accepts the offered task runs of its agents, renews the leases of running ones, and each
 * pass advances one random running task by a tool step (the FE mock's `tick`). The final step
 * posts the gateway result, which the engine's `assignment.ended` listener turns into a finished run.
 */
@Injectable()
export class SimulatorTaskRunner implements AgentRunner, OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SimulatorTaskRunner.name);
  private timer?: NodeJS.Timeout;
  private busy = false;

  constructor(
    @Inject(agentConfig.KEY) private readonly config: ConfigType<typeof agentConfig>,
    @InjectRepository(Computer) private readonly computers: Repository<Computer>,
    @InjectRepository(Assignment) private readonly assignments: Repository<Assignment>,
    private readonly gateway: AgentGatewayService,
    private readonly engine: TaskEngineService,
  ) {}

  onModuleInit(): void {
    if (!this.config.simulator) return;
    // Straight away: leases of runs seeded or left over from a restart get renewed in time.
    void this.runPass();
    this.timer = setInterval(() => void this.runPass(), SIMULATOR_TASK_TICK_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async runPass(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const simulated = await this.computers.find({
        where: { simulated: true, revokedAt: IsNull() },
      });
      const byWorkspace = new Map<string, Set<string>>();
      for (const computer of simulated) {
        const ids = byWorkspace.get(computer.workspaceId) ?? new Set<string>();
        ids.add(computer.id);
        byWorkspace.set(computer.workspaceId, ids);
      }
      for (const [workspaceId, computerIds] of byWorkspace) {
        await this.guarded(workspaceId, () => this.passFor(workspaceId, computerIds));
      }
    } catch (error) {
      this.logger.error('Simulated task runner failed', error instanceof Error ? error.stack : '');
    } finally {
      this.busy = false;
    }
  }

  private async passFor(workspaceId: string, computerIds: Set<string>): Promise<void> {
    for (const computerId of computerIds) {
      for (;;) {
        const claimed = await this.gateway.claim(computerId, undefined, 'task');
        if (!claimed) break;
        // A run cancelled or expired meanwhile must not skip the rest of the pass.
        try {
          await this.gateway.accept(claimed.id, claimed.attempt);
        } catch (error) {
          if (!(error instanceof ConflictException || error instanceof NotFoundException))
            throw error;
          this.logger.debug(`Run ${claimed.id} moved on before it was accepted`);
        }
      }
    }
    const running = await this.assignments.find({
      where: { computerId: In([...computerIds]), sourceKind: 'task', status: 'running' },
    });
    for (const assignment of running) {
      await this.gateway.heartbeat(assignment.id, assignment.attempt).catch(() => undefined);
    }
    await this.engine.tick(workspaceId, computerIds);
  }

  private async guarded(workspaceId: string, run: () => Promise<void>): Promise<void> {
    try {
      await run();
    } catch (error) {
      this.logger.error(
        `Simulated task pass failed in workspace ${workspaceId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
