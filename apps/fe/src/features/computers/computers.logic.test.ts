import { describe, expect, it } from 'vitest';
import {
  arrivals,
  formatCountdown,
  isSimulated,
  pairingCommand,
  secondsLeft,
  selectableComputers,
  serverOrigin,
} from './computers.logic';

const pc = (id: string, extra: object = {}) => ({
  id,
  name: id,
  os: 'macOS',
  status: 'online' as const,
  lastHeartbeatAt: '2026-10-17T00:00:00.000Z',
  keepAwake: false,
  cliVersion: '0.1.0',
  simulated: false,
  revokedAt: null,
  ...extra,
});

describe('computers logic', () => {
  it('strips the API prefix to get the server origin', () => {
    expect(serverOrigin('http://localhost:3000/api/v1')).toBe('http://localhost:3000');
    expect(serverOrigin('https://ws.example.com/api/v1/')).toBe('https://ws.example.com');
  });

  it('builds the connect command', () => {
    expect(pairingCommand('http://localhost:3000', 'ABCD-EFGH')).toBe(
      'pnpm agent connect --server http://localhost:3000 --code ABCD-EFGH --start',
    );
  });

  it('counts down in whole seconds and never below zero', () => {
    const now = Date.parse('2026-10-17T00:00:00.000Z');
    expect(secondsLeft('2026-10-17T00:10:00.000Z', now)).toBe(600);
    expect(secondsLeft('2026-10-17T00:00:00.000Z', now)).toBe(0);
    expect(secondsLeft('2026-10-16T23:59:00.000Z', now)).toBe(0);
    expect(formatCountdown(600)).toBe('10:00');
    expect(formatCountdown(65)).toBe('1:05');
    expect(formatCountdown(0)).toBe('0:00');
  });

  it('reports only computers missing from the baseline', () => {
    const before = new Set(['a']);
    expect(arrivals(before, [pc('a'), pc('b')]).map((c) => c.id)).toEqual(['b']);
    expect(arrivals(before, [pc('a'), pc('r', { revokedAt: '2026-10-17T00:00:00.000Z' })])).toEqual(
      [],
    );
  });

  it('marks simulated only when the API says so', () => {
    expect(isSimulated(pc('a'))).toBe(false);
    expect(isSimulated(pc('a', { simulated: true }))).toBe(true);
  });
});

describe('selectableComputers', () => {
  it('drops revoked computers and keeps order', () => {
    const list = [pc('a'), pc('b', { revokedAt: '2026-10-16T00:00:00.000Z' }), pc('c')];
    expect(selectableComputers(list).map((c) => c.id)).toEqual(['a', 'c']);
  });

  it('returns an empty list when every computer is revoked', () => {
    expect(selectableComputers([pc('a', { revokedAt: '2026-10-16T00:00:00.000Z' })])).toEqual([]);
  });
});
