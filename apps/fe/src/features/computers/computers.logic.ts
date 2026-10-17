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

/** Computers an agent can be assigned to: revoked computers are never offered. */
export const selectableComputers = (list: readonly Computer[]): Computer[] =>
  list.filter((c) => !c.revokedAt);

/** Computers that were not in `before`, in list order. A revoked computer never counts as paired. */
export const arrivals = (before: ReadonlySet<string>, now: Computer[]): Computer[] =>
  now.filter((c) => !before.has(c.id) && !c.revokedAt);

export type RevokeChoice = 'move' | 'delete' | 'keep';

/** Live computers an agent can move to when `from` is removed: real ones first, then demo, stable. */
export const moveTargets = (list: readonly Computer[], fromId: string): Computer[] =>
  selectableComputers(list)
    .filter((c) => c.id !== fromId)
    .sort((a, b) => Number(a.simulated) - Number(b.simulated));

/** What the remove dialog offers for a computer that holds `agentCount` agents. */
export function revokeOptions(
  computer: Computer,
  agentCount: number,
  list: readonly Computer[],
): {
  targets: Computer[];
  choices: RevokeChoice[];
  defaultChoice: RevokeChoice;
  defaultTarget: string;
} {
  if (agentCount === 0)
    return { targets: [], choices: [], defaultChoice: 'keep', defaultTarget: '' };
  const targets = moveTargets(list, computer.id);
  const rest: RevokeChoice = computer.simulated ? 'delete' : 'keep';
  const choices: RevokeChoice[] = targets.length ? ['move', rest] : [rest];
  const preferMove = targets.some((c) => !c.simulated);
  return {
    targets,
    choices,
    defaultChoice: preferMove ? 'move' : rest,
    defaultTarget: targets[0]?.id ?? '',
  };
}
