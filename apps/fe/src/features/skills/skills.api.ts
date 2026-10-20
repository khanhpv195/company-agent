import type {
  Agent,
  CreateSkillInput,
  RestoreSkillInput,
  SetAgentSkillsInput,
  Skill,
  SkillVersion,
  UpdateSkillInput,
} from '@repo/shared';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api-client';
import { qk } from '../../lib/query-keys';

export const useSkillsQuery = () =>
  useQuery({
    queryKey: qk.skills,
    queryFn: () => api.get<Skill[]>('/skills'),
  });

/** The library (empty until loaded). */
export const useSkills = (): Skill[] => useSkillsQuery().data ?? [];

export const useSkillVersions = (id: string, enabled = true) =>
  useQuery({
    queryKey: qk.skillVersions(id),
    queryFn: () => api.get<SkillVersion[]>(`/skills/${encodeURIComponent(id)}/versions`),
    enabled,
  });

/** A skill change shows on the library, in each agent's skill list and in the history. */
const refresh = (qc: QueryClient) =>
  Promise.all([
    qc.invalidateQueries({ queryKey: qk.skills }),
    qc.invalidateQueries({ queryKey: qk.agents }),
  ]);

/** With a `templateId` the server fills name, description and content from the template. */
export type CreateSkillBody = Partial<CreateSkillInput>;

export function useCreateSkill() {
  const qc = useQueryClient();
  return useMutation({
    meta: { silentError: true },
    mutationFn: (input: CreateSkillBody) => api.post<Skill>('/skills', input),
    onSuccess: () => refresh(qc),
  });
}

export function useUpdateSkill(id: string) {
  const qc = useQueryClient();
  return useMutation({
    meta: { silentError: true },
    mutationFn: (patch: UpdateSkillInput) =>
      api.patch<Skill>(`/skills/${encodeURIComponent(id)}`, patch),
    onSuccess: () => refresh(qc),
  });
}

export function useRestoreSkill(id: string) {
  const qc = useQueryClient();
  return useMutation({
    meta: { silentError: true },
    mutationFn: (input: RestoreSkillInput) =>
      api.post<Skill>(`/skills/${encodeURIComponent(id)}/restore`, input),
    onSuccess: () => refresh(qc),
  });
}

export function useDeleteSkill() {
  const qc = useQueryClient();
  return useMutation({
    meta: { silentError: true },
    mutationFn: (id: string) => api.delete<null>(`/skills/${encodeURIComponent(id)}`),
    onSuccess: () => refresh(qc),
  });
}

/** `skillIds` is the full enabled set of the agent. */
export function useSetAgentSkills(agentId: string) {
  const qc = useQueryClient();
  return useMutation({
    meta: { silentError: true },
    mutationFn: (skillIds: string[]) =>
      api.put<Agent>(`/agents/${encodeURIComponent(agentId)}/skills`, {
        skillIds,
      } satisfies SetAgentSkillsInput),
    onSuccess: (agent) => {
      qc.setQueryData<Agent[]>(qk.agents, (old) =>
        old?.map((a) => (a.id === agent.id ? agent : a)),
      );
      return refresh(qc);
    },
  });
}
