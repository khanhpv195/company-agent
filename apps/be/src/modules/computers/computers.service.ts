import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Computer as ComputerContract } from '@repo/shared';
import { createHash, randomBytes } from 'node:crypto';
import { Repository } from 'typeorm';
import { ClockService } from '../../common/clock';
import { returnedRows } from '../../common/utils';
import { HEARTBEAT_TIMEOUT_MS } from '../../contacts';
import { EventsService } from '../events';
import {
  COMPUTER_OFFLINE_EVENT,
  COMPUTER_ONLINE_EVENT,
  type ComputerStatusPayload,
} from './computer-events';
import { toComputer } from './computer.mapper';
import { Computer } from './entities/computer.entity';

export const API_KEY_PREFIX = 'agk_';
export const hashApiKey = (key: string): string => createHash('sha256').update(key).digest('hex');

@Injectable()
export class ComputersService {
  constructor(
    @InjectRepository(Computer) private readonly computers: Repository<Computer>,
    private readonly clock: ClockService,
    private readonly events: EventsService,
  ) {}

  async list(workspaceId: string): Promise<ComputerContract[]> {
    const rows = await this.computers.find({
      where: { workspaceId },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
    return rows.map(toComputer);
  }

  /** Returns the plaintext once; only its sha256 is stored. */
  async issueApiKey(computerId: string): Promise<string> {
    const key = `${API_KEY_PREFIX}${randomBytes(32).toString('base64url')}`;
    const result = await this.computers.update({ id: computerId }, { apiKeyHash: hashApiKey(key) });
    if (!result.affected) throw new NotFoundException({ message: 'computers.NOT_FOUND' });
    return key;
  }

  /** Marks the computer online; emits when that changes what clients see. */
  async heartbeat(computerId: string): Promise<void> {
    const now = this.clock.now();
    const rows = returnedRows<{ workspace_id: string; name: string; previous_status: string }>(
      await this.computers.query(
        `WITH prev AS (
           SELECT id, status FROM computers WHERE id = $1 FOR UPDATE
         )
         UPDATE computers c
         SET status = 'online', last_heartbeat_at = $2, updated_at = $2
         FROM prev WHERE c.id = prev.id
         RETURNING c.workspace_id, c.name, prev.status AS previous_status`,
        [computerId, now],
      ),
    );
    const row = rows[0];
    if (!row) throw new NotFoundException({ message: 'computers.NOT_FOUND' });
    if (row.previous_status !== 'online') {
      this.publishChanged(row.workspace_id);
      const payload: ComputerStatusPayload = {
        workspaceId: row.workspace_id,
        computerId,
        name: row.name,
      };
      this.events.emitDomain(COMPUTER_ONLINE_EVENT, payload);
    }
  }

  /** Flips online computers with a stale heartbeat to offline. Returns how many changed. */
  async markStale(now: Date): Promise<number> {
    const cutoff = new Date(now.getTime() - HEARTBEAT_TIMEOUT_MS);
    const rows = returnedRows<{ id: string; workspace_id: string; name: string }>(
      await this.computers.query(
        `UPDATE computers SET status = 'offline', updated_at = $2
         WHERE status = 'online' AND last_heartbeat_at < $1
         RETURNING id, workspace_id, name`,
        [cutoff, now],
      ),
    );
    for (const workspaceId of new Set(rows.map((row) => row.workspace_id))) {
      this.publishChanged(workspaceId);
    }
    for (const row of rows) {
      const payload: ComputerStatusPayload = {
        workspaceId: row.workspace_id,
        computerId: row.id,
        name: row.name,
      };
      this.events.emitDomain(COMPUTER_OFFLINE_EVENT, payload);
    }
    return rows.length;
  }

  /** Computer status drives derived agent status, so both lists change together. */
  private publishChanged(workspaceId: string): void {
    this.events.publish(workspaceId, { type: 'computers.changed' });
    this.events.publish(workspaceId, { type: 'agents.changed' });
  }
}
