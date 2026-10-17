import { Logger } from '@nestjs/common';
import type { Repository } from 'typeorm';
import type { ClockService } from '../../common/clock';
import type { Computer } from '../computers/entities/computer.entity';
import type { EventsService } from '../events';
import { SimulatorService } from './simulator.service';

describe('SimulatorService.beat', () => {
  let query: jest.Mock;
  let publish: jest.Mock;
  let service: SimulatorService;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    query = jest.fn();
    publish = jest.fn();
    service = new SimulatorService(
      { simulator: true, reconcileEnabled: true },
      { query } as unknown as Repository<Computer>,
      { now: () => new Date('2026-01-01T00:00:00Z') } as ClockService,
      { publish } as unknown as EventsService,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  it('publishes nothing when every computer was already online', async () => {
    query.mockResolvedValue([
      { workspace_id: 'w1', previous_status: 'online' },
      { workspace_id: 'w2', previous_status: 'online' },
    ]);
    await service.beat();
    expect(query).toHaveBeenCalledTimes(1);
    expect(publish).not.toHaveBeenCalled();
  });

  it('publishes once per workspace where a computer flipped to online', async () => {
    query.mockResolvedValue([
      { workspace_id: 'w1', previous_status: 'offline' },
      { workspace_id: 'w1', previous_status: 'offline' },
      { workspace_id: 'w2', previous_status: 'online' },
    ]);
    await service.beat();
    expect(publish.mock.calls).toEqual([
      ['w1', { type: 'computers.changed' }],
      ['w1', { type: 'agents.changed' }],
    ]);
  });

  it('swallows a failed heartbeat and can beat again', async () => {
    query.mockRejectedValueOnce(new Error('db down')).mockResolvedValueOnce([]);
    await expect(service.beat()).resolves.toBeUndefined();
    await service.beat();
    expect(query).toHaveBeenCalledTimes(2);
  });
});
