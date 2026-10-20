import type {
  Agent,
  AgentActivity,
  AgentSkill,
  CreateAgentInput,
  UpdateAgentInput,
} from '@repo/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api-client';
import { qk } from '../../lib/query-keys';
import { useSession } from '../workspace/workspace.api';
import { canManageAgents } from './agent-form.logic';

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
    meta: { silentError: true },
    onSuccess: (agent) => {
      qc.setQueryData<Agent[]>(qk.agents, (old) =>
        old?.map((a) => (a.id === agent.id ? agent : a)),
      );
      void qc.invalidateQueries({ queryKey: qk.rooms });
      void qc.invalidateQueries({ queryKey: qk.departments });
    },
  });
}

/** Owner/admin only: the API answers 403 to a member for every agent, connection and scheduler write. */
export const useCanManage = (): boolean => canManageAgents(useSession().data?.user.role);

export const useSkillCatalog = (enabled = true) =>
  useQuery({
    queryKey: ['agents', 'skill-catalog'] as const,
    queryFn: () => api.get<AgentSkill[]>('/agents/skill-catalog'),
    enabled,
    staleTime: Infinity,
  }).data;

export function useCreateAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateAgentInput) => api.post<Agent>('/agents', input),
    meta: { silentError: true },
    onSuccess: (agent) => {
      qc.setQueryData<Agent[]>(qk.agents, (old) => (old ? [...old, agent] : old));
      void qc.invalidateQueries({ queryKey: qk.agents });
      void qc.invalidateQueries({ queryKey: qk.billing });
      void qc.invalidateQueries({ queryKey: qk.rooms });
      void qc.invalidateQueries({ queryKey: qk.departments });
    },
  });
}

/** Deleting releases the agent's tasks, DM and connections, so those lists refresh too. */
export function useDeleteAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<null>(`/agents/${id}`),
    meta: { silentError: true },
    onSuccess: (_data, id) => {
      qc.setQueryData<Agent[]>(qk.agents, (old) => old?.filter((a) => a.id !== id));
      for (const key of [qk.agents, qk.tasks, qk.rooms, qk.connections, qk.dashboard, qk.billing])
        void qc.invalidateQueries({ queryKey: key });
    },
  });
}
