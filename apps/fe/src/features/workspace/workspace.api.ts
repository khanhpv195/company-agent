import type { Agent, Computer, Member, Session } from '@repo/shared';
import { queryOptions, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { api } from '../../lib/api-client';
import { qk } from '../../lib/query-keys';

export const sessionQuery = queryOptions({
  queryKey: qk.session,
  queryFn: () => api.get<Session>('/session'),
  retry: false,
  staleTime: Infinity,
});
export const membersQuery = queryOptions({
  queryKey: qk.members,
  queryFn: () => api.get<Member[]>('/members'),
});
export const agentsQuery = queryOptions({
  queryKey: qk.agents,
  queryFn: () => api.get<Agent[]>('/agents'),
});
export const computersQuery = queryOptions({
  queryKey: qk.computers,
  queryFn: () => api.get<Computer[]>('/computers'),
});

export const useSession = () => useQuery(sessionQuery);
export const useMembers = () => useQuery(membersQuery).data ?? [];
export const useAgents = () => useQuery(agentsQuery).data ?? [];
export const useComputers = () => useQuery(computersQuery).data ?? [];

export interface People {
  agents: Agent[];
  members: Member[];
  computers: Computer[];
  agent: (id: string | null | undefined) => Agent | undefined;
  member: (id: string | null | undefined) => Member | undefined;
  computer: (id: string | null | undefined) => Computer | undefined;
  computerOf: (agent: Agent) => Computer | undefined;
  name: (id: string | null | undefined) => string;
  /** Names that render as @mentions, longest first. */
  mentionNames: string[];
}

/** Lookups across agents, members and computers. */
export function usePeople(): People {
  const agents = useAgents();
  const members = useMembers();
  const computers = useComputers();
  return useMemo(() => {
    const agent = (id: string | null | undefined) =>
      id ? agents.find((a) => a.id === id) : undefined;
    const member = (id: string | null | undefined) =>
      id ? members.find((m) => m.id === id) : undefined;
    const computer = (id: string | null | undefined) =>
      id ? computers.find((c) => c.id === id) : undefined;
    return {
      agents,
      members,
      computers,
      agent,
      member,
      computer,
      computerOf: (a: Agent) => computer(a.computerId),
      name: (id: string | null | undefined) =>
        !id
          ? 'Chưa giao'
          : (agent(id)?.name ??
            member(id)?.name ??
            // Once the lists are in, an unknown id is an agent that was deleted.
            (agents.length || members.length ? 'Agent đã xoá' : id)),
      mentionNames: [...agents.map((a) => a.name), ...members.map((m) => m.name)].sort(
        (a, b) => b.length - a.length,
      ),
    };
  }, [agents, members, computers]);
}

export const ROLE_NAME: Record<Member['role'], string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
};
