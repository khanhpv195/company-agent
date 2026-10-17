import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ClockService } from '../../common/clock';
import { returnedRows } from '../../common/utils';
import { agentConfig } from '../../config';
import { SIMULATOR_HEARTBEAT_MS } from '../../contacts';
import { COMPUTER_ONLINE_EVENT, type ComputerStatusPayload } from '../computers/computer-events';
import { Computer } from '../computers/entities/computer.entity';
import { EventsService } from '../events';

/** Stands in for real daemons: keeps `simulated` computers online. Runs only with AGENT_SIMULATOR. */
@Injectable()
export class SimulatorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SimulatorService.name);
  private timer?: NodeJS.Timeout;
  private busy = false;

  constructor(
    @Inject(agentConfig.KEY) private readonly config: ConfigType<typeof agentConfig>,
    @InjectRepository(Computer) private readonly computers: Repository<Computer>,
    private readonly clock: ClockService,
    private readonly events: EventsService,
  ) {}

  onModuleInit(): void {
    if (!this.config.simulator) return;
    void this.beat();
    this.timer = setInterval(() => void this.beat(), SIMULATOR_HEARTBEAT_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** One UPDATE for every simulated computer; events only where a computer actually came online. */
  async beat(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const rows = returnedRows<{
        id: string;
        name: string;
        workspace_id: string;
        previous_status: string;
      }>(
        await this.computers.query(
          `WITH prev AS (
             SELECT id, status FROM computers WHERE simulated = true AND revoked_at IS NULL FOR UPDATE
           ), upd AS (
             UPDATE computers c
             SET status = 'online', last_heartbeat_at = $1, updated_at = $1
             FROM prev WHERE c.id = prev.id
             RETURNING c.id, c.name, c.workspace_id, prev.status AS previous_status
           )
           SELECT id, name, workspace_id, previous_status FROM upd`,
          [this.clock.now()],
        ),
      );
      const flipped = rows.filter((row) => row.previous_status !== 'online');
      for (const workspaceId of new Set(flipped.map((row) => row.workspace_id))) {
        this.events.publish(workspaceId, { type: 'computers.changed' });
        this.events.publish(workspaceId, { type: 'agents.changed' });
      }
      // The same domain event a real heartbeat emits: offline attention items auto-resolve.
      for (const row of flipped) {
        const payload: ComputerStatusPayload = {
          workspaceId: row.workspace_id,
          computerId: row.id,
          name: row.name,
        };
        this.events.emitDomain(COMPUTER_ONLINE_EVENT, payload);
      }
    } catch (error) {
      this.logger.error('Simulator heartbeat failed', error instanceof Error ? error.stack : '');
    } finally {
      this.busy = false;
    }
  }
}
