import type { Computer } from '@repo/shared';

export interface PairingCode {
  code: string;
  expiresAt: string;
}

/** Simulated computers are demo machines; only the API's `simulated` flag marks them. */
export const isSimulated = (c: Computer): boolean => c.simulated;

/** `https://host` from the API base `https://host/api/v1`. */
export const serverOrigin = (apiUrl: string): string => apiUrl.replace(/\/api\/v\d+\/?$/, '');

export const pairingCommand = (server: string, code: string): string =>
  `pnpm agent connect --server ${server} --code ${code} --start`;

/** Whole seconds until `expiresAt`, never negative. */
export const secondsLeft = (expiresAt: string, now: number): number =>
  Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 1000));

export const formatCountdown = (seconds: number): string => {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
};

/** Computers that were not in `before`, in list order. A revoked computer never counts as paired. */
export const arrivals = (before: ReadonlySet<string>, now: Computer[]): Computer[] =>
  now.filter((c) => !before.has(c.id) && !c.revokedAt);
