import type { Agent, AgentActivity, UpdateAgentInput } from '@repo/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api-client';
import { qk } from '../../lib/query-keys';

export const useAgentActivity = (id: string) =>
  useQuery({
    queryKey: qk.agentActivity(id),
    queryFn: () => api.get<AgentActivity[]>(`/agents/${id}/activity`),
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
