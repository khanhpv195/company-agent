import { isHeartbeatStale } from './computer-status.util';

describe('isHeartbeatStale', () => {
  const now = new Date('2026-01-01T00:00:30.000Z');

  it('is fresh at exactly the timeout', () => {
    expect(isHeartbeatStale(new Date('2026-01-01T00:00:15.000Z'), now, 15_000)).toBe(false);
  });

  it('is stale after the timeout', () => {
    expect(isHeartbeatStale(new Date('2026-01-01T00:00:14.999Z'), now, 15_000)).toBe(true);
  });

  it('is fresh for a heartbeat in the future (clock skew)', () => {
    expect(isHeartbeatStale(new Date('2026-01-01T00:01:00.000Z'), now, 15_000)).toBe(false);
  });
});
