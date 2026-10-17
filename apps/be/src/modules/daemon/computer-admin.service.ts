import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { isUUID } from 'class-validator';
import { DataSource, In, Not } from 'typeorm';
import { ClockService } from '../../common/clock';
import type { AuthContext } from '../../common/types';
import { Computer } from '../computers/entities/computer.entity';
import { EventsService } from '../events';
import { AgentGatewayService } from '../gateway/agent-gateway.service';
import { Assignment, TERMINAL_STATUSES } from '../gateway/entities/assignment.entity';

@Injectable()
export class ComputerAdminService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly clock: ClockService,
    private readonly gateway: AgentGatewayService,
    private readonly events: EventsService,
  ) {}

  /**
   * Soft revoke: the key is dropped first (the daemon's next call is a 401), the computer reads
   * offline, and everything its agents had open is cancelled through the gateway, so running
   * tasks go back to todo and chat replies fail like any other cancellation.
   */
  async revoke(auth: AuthContext, id: string): Promise<null> {
    const computer = isUUID(id)
      ? await this.dataSource
          .getRepository(Computer)
          .findOneBy({ id, workspaceId: auth.workspaceId })
      : null;
    if (!computer) throw new NotFoundException({ message: 'computers.NOT_FOUND' });
    if (computer.simulated) throw new ConflictException({ message: 'computers.SIMULATED' });

    await this.dataSource.getRepository(Computer).update(
      { id },
      {
        apiKeyHash: null,
        status: 'offline',
        revokedAt: this.clock.now(),
        updatedAt: this.clock.now(),
      },
    );
    const open = await this.dataSource.getRepository(Assignment).find({
      where: { computerId: id, status: Not(In([...TERMINAL_STATUSES])) },
      select: { id: true },
    });
    for (const { id: assignmentId } of open) {
      try {
        await this.gateway.cancel(assignmentId);
      } catch (error) {
        // Finished a moment ago on its own: nothing left to cancel.
        if (!(error instanceof ConflictException || error instanceof NotFoundException))
          throw error;
      }
    }
    this.events.publish(auth.workspaceId, { type: 'computers.changed' });
    this.events.publish(auth.workspaceId, { type: 'agents.changed' });
    return null;
  }
}
