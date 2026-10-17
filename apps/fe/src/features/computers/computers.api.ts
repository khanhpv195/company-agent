import type { Computer } from '@repo/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api-client';
import { qk } from '../../lib/query-keys';
import { computersQuery } from '../workspace/workspace.api';
import { arrivals, type PairingCode } from './computers.logic';

/** A new pairing code is requested each time (single use, expires after 10 minutes). */
export const useCreatePairingCode = () =>
  useMutation({
    mutationFn: () => api.post<PairingCode>('/computers/pairing-codes'),
    meta: { silentError: true },
  });

/** Revokes a real computer (owner/admin). The API answers 409 for simulated ones. */
export const useRevokeComputer = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (computerId: string) => api.delete<null>(`/computers/${computerId}`),
    meta: { silentError: true },
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: qk.computers }),
        qc.invalidateQueries({ queryKey: qk.agents }),
        qc.invalidateQueries({ queryKey: qk.billing }),
      ]),
  });
};

/**
 * Polls the computer list every 2 s while a pairing UI is mounted. The first list received
 * is the baseline; `arrived` is the first computer that was not in it, i.e. the one just paired.
 */
export function useComputerArrivals(): {
  computers: Computer[];
  arrived: Computer | undefined;
  rebase: () => void;
} {
  const data = useQuery({ ...computersQuery, refetchInterval: 2000 }).data;
  const [baseline, setBaseline] = useState<Set<string> | null>(null);
  // Adjusting state during render (not in an effect) so the baseline exists on this render.
  if (!baseline && data) setBaseline(new Set(data.map((c) => c.id)));
  const computers = data ?? [];
  const arrived = baseline ? arrivals(baseline, computers)[0] : undefined;
  const qc = useQueryClient();
  // A newly paired computer changes the computer count, so the plan meters go stale.
  useEffect(() => {
    if (arrived) void qc.invalidateQueries({ queryKey: qk.billing });
  }, [arrived, qc]);
  /** Forget the current list: the next computer to appear counts as new. */
  const rebase = () => setBaseline(new Set(computers.map((c) => c.id)));
  return { computers, arrived, rebase };
}
