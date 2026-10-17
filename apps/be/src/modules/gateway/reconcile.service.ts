import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import { ClockService } from '../../common/clock';
import { agentConfig } from '../../config';
import { RECONCILE_INTERVAL_MS } from '../../contacts';
import { ComputersService } from '../computers/computers.service';
import { AgentGatewayService } from './agent-gateway.service';

/** Periodic housekeeping; later phases add `pickNext` here. */
@Injectable()
export class ReconcileService {
  private readonly logger = new Logger(ReconcileService.name);
  private running = false;

  constructor(
    @Inject(agentConfig.KEY) private readonly config: ConfigType<typeof agentConfig>,
    private readonly clock: ClockService,
    private readonly computers: ComputersService,
    private readonly gateway: AgentGatewayService,
  ) {}

  @Interval(RECONCILE_INTERVAL_MS)
  async tick(): Promise<void> {
    if (!this.config.reconcileEnabled || this.running) return;
    this.running = true;
    try {
      const now = this.clock.now();
      await this.step('markStale', () => this.computers.markStale(now));
      await this.step('expireOfflineTaskAssignments', () =>
        this.gateway.expireOfflineTaskAssignments(),
      );
      await this.step('expireOfflineChatAssignments', () =>
        this.gateway.expireOfflineChatAssignments(),
      );
      await this.step('reconcileLeases', () => this.gateway.reconcileLeases(now));
    } finally {
      this.running = false;
    }
  }

  /** Each step fails alone: one throwing must not skip the other. */
  private async step(name: string, run: () => Promise<unknown>): Promise<void> {
    try {
      await run();
    } catch (error) {
      this.logger.error(
        `Reconcile step ${name} failed`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
