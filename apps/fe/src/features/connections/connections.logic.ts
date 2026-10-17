import type { Connection, ConnectionAvailability } from '@repo/shared';

/** What the card's main action does: start a connection, manage a live one, or nothing yet. */
export type ConnectionCta = 'connect' | 'manage' | 'soon';

/** The API always sends `availability`; a missing value is treated as `simulated`. */
export function connectionAvailability(
  c: Pick<Connection, 'availability'>,
): ConnectionAvailability {
  return c.availability ?? 'simulated';
}

export const isUnavailable = (c: Pick<Connection, 'availability'>) =>
  connectionAvailability(c) === 'unavailable';

export const isSimulated = (c: Pick<Connection, 'availability'>) =>
  connectionAvailability(c) === 'simulated';

/**
 * Connected connections stay manageable (disconnect works) even when the provider is
 * unavailable. Not-connected ones that are unavailable show "soon" and cannot start.
 */
export function connectionCta(c: Pick<Connection, 'status' | 'availability'>): ConnectionCta {
  if (c.status === 'on') return 'manage';
  return isUnavailable(c) ? 'soon' : 'connect';
}

/** The connect/configure wizard only opens for available providers. */
export const canOpenWizard = (c: Pick<Connection, 'availability'>) => !isUnavailable(c);
