import { decideRefresh, hashToken } from './token.service';

describe('hashToken', () => {
  it('is a deterministic sha256 hex digest', () => {
    expect(hashToken('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(hashToken('abc')).toHaveLength(64);
    expect(hashToken('abd')).not.toBe(hashToken('abc'));
  });
});

describe('decideRefresh', () => {
  const now = new Date('2026-01-01T00:00:00Z');
  const future = new Date('2026-02-01T00:00:00Z');
  const past = new Date('2025-12-01T00:00:00Z');

  it('rejects unknown tokens', () => {
    expect(decideRefresh(null, now)).toBe('invalid');
  });

  it('rejects expired tokens, revoked or not', () => {
    expect(decideRefresh({ expiresAt: past, revokedAt: null }, now)).toBe('invalid');
    expect(decideRefresh({ expiresAt: past, revokedAt: past }, now)).toBe('invalid');
  });

  it('accepts a live unrevoked token', () => {
    expect(decideRefresh({ expiresAt: future, revokedAt: null }, now)).toBe('ok');
  });

  it('flags a revoked live token as reuse', () => {
    expect(decideRefresh({ expiresAt: future, revokedAt: past }, now)).toBe('reuse');
  });
});
