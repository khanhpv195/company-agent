import type { Connection } from '@repo/shared';
import { describe, expect, it } from 'vitest';
import {
  canOpenWizard,
  connectionAvailability,
  connectionCta,
  isSimulated,
  isUnavailable,
} from './connections.logic';

const conn = (status: 'on' | 'off', availability?: Connection['availability']) =>
  ({ status, availability }) as Pick<Connection, 'status' | 'availability'>;

describe('connectionCta', () => {
  it('offers connect for available, not-connected providers', () => {
    expect(connectionCta(conn('off', 'simulated'))).toBe('connect');
    expect(connectionCta(conn('off'))).toBe('connect');
  });

  it('shows soon for unavailable, not-connected providers', () => {
    expect(connectionCta(conn('off', 'unavailable'))).toBe('soon');
  });

  it('keeps connected providers manageable, even when unavailable', () => {
    expect(connectionCta(conn('on', 'simulated'))).toBe('manage');
    expect(connectionCta(conn('on', 'unavailable'))).toBe('manage');
  });
});

describe('availability helpers', () => {
  it('treats a missing availability as simulated', () => {
    expect(connectionAvailability({})).toBe('simulated');
    expect(isSimulated({})).toBe(true);
    expect(isUnavailable({})).toBe(false);
  });

  it('blocks the wizard only when unavailable', () => {
    expect(canOpenWizard({ availability: 'unavailable' })).toBe(false);
    expect(canOpenWizard({ availability: 'simulated' })).toBe(true);
    expect(canOpenWizard({})).toBe(true);
  });
});
