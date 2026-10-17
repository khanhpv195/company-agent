import { ClockService } from '../../common/clock';
import { LimitReachedException, PlanLimitsService } from './plan-limits.service';
import type { EntityManager } from 'typeorm';

const NOW = new Date('2026-01-01T00:00:00Z');

const build = (row: { seats: string; agents: string; computers: string }) => {
  const query = jest.fn().mockResolvedValue([row]);
  const service = new PlanLimitsService({ now: () => NOW } as unknown as ClockService);
  return { service, query, manager: { query } as unknown as EntityManager };
};

describe('PlanLimitsService', () => {
  it('reports usage as numbers and passes the clock to the pending-invite filter', async () => {
    const { service, query, manager } = build({ seats: '3', agents: '2', computers: '1' });
    await expect(service.usage(manager, 'ws')).resolves.toEqual({
      seats: 3,
      agents: 2,
      computers: 1,
    });
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(params).toEqual(['ws', NOW]);
    // counting rules live in the SQL: pin them
    expect(sql).toContain('removed_at IS NULL'); // members
    expect(sql).toContain('accepted_at IS NULL');
    expect(sql).toContain('revoked_at IS NULL');
    expect(sql).toContain('expires_at > $2'); // pending, unexpired invites
    expect(sql).toMatch(
      /agents a JOIN computers ac[\s\S]*deleted_at IS NULL[\s\S]*simulated = false/,
    );
    expect(sql).toMatch(/FROM computers WHERE[\s\S]*revoked_at IS NULL[\s\S]*simulated = false/);
  });

  it('allows adding up to the plan limit and refuses past it, with details', async () => {
    // free: 3 seats, 2 agents, 1 computer
    const ok = build({ seats: '2', agents: '0', computers: '0' });
    await expect(
      ok.service.assertCanAdd(ok.manager, 'ws', 'free', 'seats'),
    ).resolves.toBeUndefined();

    const full = build({ seats: '3', agents: '0', computers: '0' });
    const error = await full.service
      .assertCanAdd(full.manager, 'ws', 'free', 'seats')
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LimitReachedException);
    expect((error as LimitReachedException).getResponse()).toMatchObject({
      details: { resource: 'seats', limit: 3, used: 3, plan: 'free' },
    });
  });

  it('honours the number being added and the plan', async () => {
    const { service, manager } = build({ seats: '8', agents: '0', computers: '0' });
    await expect(service.assertCanAdd(manager, 'ws', 'pro', 'seats', 2)).resolves.toBeUndefined();
    await expect(service.assertCanAdd(manager, 'ws', 'pro', 'seats', 3)).rejects.toBeInstanceOf(
      LimitReachedException,
    );
    await expect(service.assertCanAdd(manager, 'ws', 'free', 'seats')).rejects.toBeInstanceOf(
      LimitReachedException,
    );
  });

  it('lockPlan returns the plan, and throws when the workspace is gone', async () => {
    const found = new PlanLimitsService({ now: () => NOW } as unknown as ClockService);
    const manager = {
      query: jest.fn().mockResolvedValue([{ plan: 'team' }]),
    } as unknown as EntityManager;
    await expect(found.lockPlan(manager, 'ws')).resolves.toBe('team');
    const gone = { query: jest.fn().mockResolvedValue([]) } as unknown as EntityManager;
    await expect(found.lockPlan(gone, 'ws')).rejects.toThrow();
  });
});
