import type { ConnectInput, Connection } from '@repo/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api-client';
import { qk } from '../../lib/query-keys';

export const useConnections = () =>
  useQuery({ queryKey: qk.connections, queryFn: () => api.get<Connection[]>('/connections') })
    .data ?? [];

export function useConnectionActions() {
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: qk.connections });
    void qc.invalidateQueries({ queryKey: qk.rooms });
  };
  return {
    authorize: useMutation({
      mutationFn: (id: string) => api.post(`/connections/${id}/authorize`),
    }),
    connect: useMutation({
      mutationFn: (v: { id: string } & ConnectInput) => {
        const { id, ...input } = v;
        return api.post<Connection>(`/connections/${id}/connect`, input);
      },
      onSuccess: refresh,
    }),
    disconnect: useMutation({
      mutationFn: (id: string) => api.delete<Connection>(`/connections/${id}`),
      onSuccess: refresh,
    }),
  };
}
