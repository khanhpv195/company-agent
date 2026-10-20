import { describe, expect, it } from 'vitest';
import { ApiError } from '../../lib/api-client';
import {
  atLimit,
  barPct,
  limitDetailsOf,
  meterOf,
  planActionKind,
  planCardState,
  salesMailto,
} from './billing.logic';

const limitError = (details: Record<string, unknown> | undefined) =>
  new ApiError('Limit', 403, {
    success: false,
    data: null,
    message: 'billing.LIMIT_REACHED',
    meta: { statusCode: 403, path: '/x', timestamp: '', details },
  });

describe('meterOf', () => {
  it('is ok below 80%, warn from 80%, full at 100%', () => {
    expect(meterOf(1, 10).level).toBe('ok');
    expect(meterOf(7, 10).level).toBe('ok');
    expect(meterOf(8, 10).level).toBe('warn');
    expect(meterOf(9, 10).level).toBe('warn');
    expect(meterOf(10, 10)).toMatchObject({ level: 'full', pct: 100 });
    expect(meterOf(12, 10)).toMatchObject({ level: 'full', pct: 100 });
  });
  it('treats a zero limit as full', () => {
    expect(meterOf(0, 0).level).toBe('full');
  });
  it('rounds the percentage', () => {
    expect(meterOf(1, 3).pct).toBe(33);
  });
});

describe('atLimit', () => {
  const b = {
    usage: { seats: 3, agents: 1, computers: 1 },
    limits: { seats: 3, agents: 2, computers: 1 },
  };
  it('compares usage with the limit per resource', () => {
    expect(atLimit(b, 'seats')).toBe(true);
    expect(atLimit(b, 'agents')).toBe(false);
    expect(atLimit(b, 'computers')).toBe(true);
    expect(atLimit(undefined, 'seats')).toBe(false);
  });
  it('is never true when the server runs without plan limits', () => {
    const off = { ...b, limitsEnabled: false };
    expect(atLimit(off, 'seats')).toBe(false);
    expect(atLimit(off, 'computers')).toBe(false);
    expect(atLimit({ ...b, limitsEnabled: true }, 'seats')).toBe(true);
  });
});

describe('limitDetailsOf', () => {
  it('reads the details of a limit error', () => {
    expect(
      limitDetailsOf(limitError({ resource: 'agents', limit: 2, used: 2, plan: 'free' })),
    ).toEqual({ resource: 'agents', limit: 2, used: 2, plan: 'free' });
  });
  it('is null for other errors', () => {
    expect(limitDetailsOf(limitError(undefined))).toBeNull();
    expect(limitDetailsOf(limitError({ resource: 'bogus' }))).toBeNull();
    expect(limitDetailsOf(new ApiError('x', 403))).toBeNull();
    expect(limitDetailsOf(new Error('x'))).toBeNull();
  });
});

describe('planCardState', () => {
  it('marks current, upgrade and downgrade', () => {
    expect(planCardState({ id: 'pro' }, 'pro', true)).toBe('current');
    expect(planCardState({ id: 'team' }, 'pro', true)).toBe('upgrade');
    expect(planCardState({ id: 'free' }, 'pro', true)).toBe('downgrade');
    expect(planCardState({ id: 'pro' }, 'free', true)).toBe('upgrade');
  });
  it('offers contact when checkout is unavailable, except on the current plan', () => {
    expect(planCardState({ id: 'team' }, 'free', false)).toBe('contact');
    expect(planCardState({ id: 'free' }, 'free', false)).toBe('current');
  });
});

describe('salesMailto / barPct', () => {
  it('hides the mail link without an address', () => {
    expect(salesMailto('', 'pro')).toBeNull();
    expect(salesMailto(undefined, 'pro')).toBeNull();
    expect(salesMailto(' a@b.co ', 'pro')).toBe('mailto:a@b.co?subject=Agent%3A%20pro%20plan');
  });
  it('scales bars with a visible minimum', () => {
    expect(barPct(0, 5)).toBe(0);
    expect(barPct(5, 5)).toBe(100);
    expect(barPct(0.01, 5)).toBe(4);
    expect(barPct(1, 0)).toBe(0);
  });
});

describe('planActionKind', () => {
  it('uses the portal for free and for subscribed workspaces, else checkout', () => {
    expect(planActionKind({ id: 'free' }, null)).toBe('portal');
    expect(planActionKind({ id: 'team' }, { status: 'active' })).toBe('portal');
    expect(planActionKind({ id: 'team' }, null)).toBe('checkout');
    expect(planActionKind({ id: 'pro' }, { status: 'canceled' })).toBe('checkout');
  });
});
