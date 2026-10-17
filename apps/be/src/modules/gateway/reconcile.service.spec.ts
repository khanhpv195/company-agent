import { Logger } from '@nestjs/common';
import type { ClockService } from '../../common/clock';
import type { ComputersService } from '../computers/computers.service';
import type { AgentGatewayService } from './agent-gateway.service';
import { ReconcileService } from './reconcile.service';

describe('ReconcileService.tick', () => {
  const now = new Date('2026-01-01T00:00:00Z');
  let markStale: jest.Mock;
  let reconcileLeases: jest.Mock;
  let expireOfflineTaskAssignments: jest.Mock;
  let expireOfflineChatAssignments: jest.Mock;
  let service: ReconcileService;

  const build = (reconcileEnabled = true): ReconcileService =>
    new ReconcileService(
      { simulator: false, reconcileEnabled },
      { now: () => now } as ClockService,
      { markStale } as unknown as ComputersService,
      {
        reconcileLeases,
        expireOfflineTaskAssignments,
        expireOfflineChatAssignments,
      } as unknown as AgentGatewayService,
    );

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    markStale = jest.fn().mockResolvedValue(0);
    reconcileLeases = jest.fn().mockResolvedValue(0);
    expireOfflineTaskAssignments = jest.fn().mockResolvedValue(0);
    expireOfflineChatAssignments = jest.fn().mockResolvedValue(0);
    service = build();
  });

  afterEach(() => jest.restoreAllMocks());

  it('runs both steps with the same timestamp', async () => {
    await service.tick();
    expect(markStale).toHaveBeenCalledWith(now);
    expect(reconcileLeases).toHaveBeenCalledWith(now);
  });

  it('still reconciles leases when markStale throws', async () => {
    markStale.mockRejectedValue(new Error('db down'));
    await expect(service.tick()).resolves.toBeUndefined();
    expect(reconcileLeases).toHaveBeenCalledTimes(1);
  });

  it('still marks stale computers when reconcileLeases throws', async () => {
    reconcileLeases.mockRejectedValue(new Error('boom'));
    await expect(service.tick()).resolves.toBeUndefined();
    expect(markStale).toHaveBeenCalledTimes(1);
  });

  it('still runs the other steps when the chat offline expiry throws', async () => {
    expireOfflineChatAssignments.mockRejectedValue(new Error('boom'));
    await expect(service.tick()).resolves.toBeUndefined();
    expect(expireOfflineTaskAssignments).toHaveBeenCalledTimes(1);
    expect(reconcileLeases).toHaveBeenCalledTimes(1);
  });

  it('skips an overlapping tick, then runs again once the first finishes', async () => {
    let release!: () => void;
    markStale.mockReturnValueOnce(new Promise<number>((resolve) => (release = () => resolve(0))));
    const first = service.tick();
    await service.tick();
    expect(markStale).toHaveBeenCalledTimes(1);
    release();
    await first;
    await service.tick();
    expect(markStale).toHaveBeenCalledTimes(2);
  });

  it('does nothing when reconciliation is disabled', async () => {
    await build(false).tick();
    expect(markStale).not.toHaveBeenCalled();
    expect(reconcileLeases).not.toHaveBeenCalled();
  });
});
