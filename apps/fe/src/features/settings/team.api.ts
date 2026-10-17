import type {
  AssignableRole,
  CreateInviteInput,
  CreateInviteResult,
  DeleteWorkspaceInput,
  Invite,
  Member,
  Session,
  TransferOwnershipInput,
  UpdateMemberRoleInput,
  UpdateWorkspaceInput,
} from '@repo/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api-client';
import { qk } from '../../lib/query-keys';

/** Pending invites; only owners and admins may read them (members would get a 403). */
export const useInvites = (enabled: boolean) =>
  useQuery({
    queryKey: qk.invites,
    queryFn: () => api.get<Invite[]>('/invites'),
    enabled,
  });

export function useCreateInvite() {
  const qc = useQueryClient();
  return useMutation({
    meta: { silentError: true },
    mutationFn: (input: CreateInviteInput) => api.post<CreateInviteResult>('/invites', input),
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: qk.invites }),
        qc.invalidateQueries({ queryKey: qk.billing }),
      ]),
  });
}

export function useRevokeInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<null>(`/invites/${encodeURIComponent(id)}`),
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: qk.invites }),
        qc.invalidateQueries({ queryKey: qk.billing }),
      ]),
  });
}

export function useChangeMemberRole() {
  const qc = useQueryClient();
  return useMutation({
    meta: { silentError: true },
    mutationFn: ({ id, role }: { id: string; role: AssignableRole }) =>
      api.patch<Member>(`/members/${encodeURIComponent(id)}`, {
        role,
      } satisfies UpdateMemberRoleInput),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.members }),
  });
}

export function useRemoveMember() {
  const qc = useQueryClient();
  return useMutation({
    meta: { silentError: true },
    mutationFn: (id: string) => api.delete<null>(`/members/${encodeURIComponent(id)}`),
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: qk.members }),
        qc.invalidateQueries({ queryKey: qk.billing }),
      ]),
  });
}

export function useTransferOwnership() {
  const qc = useQueryClient();
  return useMutation({
    meta: { silentError: true },
    mutationFn: (input: TransferOwnershipInput) =>
      api.post<null>('/workspace/transfer-ownership', input),
    onSuccess: async () => {
      // My role changed (owner -> admin), so the session drives every permission check.
      await Promise.all([
        qc.invalidateQueries({ queryKey: qk.session }),
        qc.invalidateQueries({ queryKey: qk.members }),
        qc.invalidateQueries({ queryKey: qk.invites }),
      ]);
    },
  });
}

export function useRenameWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    meta: { silentError: true },
    mutationFn: (input: UpdateWorkspaceInput) =>
      api.patch<Session['workspace']>('/workspace', input),
    onSuccess: (workspace) =>
      qc.setQueryData<Session>(qk.session, (old) => (old ? { ...old, workspace } : old)),
  });
}

export const useDeleteWorkspace = () =>
  useMutation({
    meta: { silentError: true },
    mutationFn: (input: DeleteWorkspaceInput) => api.delete<null>('/workspace', input),
  });
