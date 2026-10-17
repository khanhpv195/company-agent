import type { Agent, AgentActivity, UpdateAgentInput } from '@repo/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api-client';
import { qk } from '../../lib/query-keys';

/** `enabled` stays false for an unknown agent id (the API answers 404 for it). */
export const useAgentActivity = (id: string, enabled = true) =>
  useQuery({
    queryKey: qk.agentActivity(id),
    queryFn: () => api.get<AgentActivity[]>(`/agents/${id}/activity`),
    enabled,
  }).data ?? [];

export function useUpdateAgent(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: UpdateAgentInput) => api.patch<Agent>(`/agents/${id}`, patch),
    onSuccess: (agent) =>
      qc.setQueryData<Agent[]>(qk.agents, (old) =>
        old?.map((a) => (a.id === agent.id ? agent : a)),
      ),
  });
}
