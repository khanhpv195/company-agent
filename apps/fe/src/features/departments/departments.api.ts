import type {
  CreateDepartmentInput,
  Department,
  Member,
  ReorderDepartmentsInput,
  SetDepartmentInput,
  SetMemberTitleInput,
  Session,
  UpdateDepartmentInput,
} from '@repo/shared';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { api } from '../../lib/api-client';
import { qk } from '../../lib/query-keys';
import { sortDepartments } from './departments.logic';

export const useDepartmentsQuery = () =>
  useQuery({
    queryKey: qk.departments,
    queryFn: () => api.get<Department[]>('/departments'),
  });

/** Live departments in display order, plus a lookup by id. */
export function useDepartments() {
  const data = useDepartmentsQuery().data;
  return useMemo(() => {
    const list = sortDepartments(data ?? []);
    return { list, byId: (id: string | null | undefined) => list.find((d) => d.id === id) };
  }, [data]);
}

/** Departments, people and rooms all change together (assignments, the department room). */
const refreshAll = (qc: QueryClient) =>
  Promise.all(
    [qk.departments, qk.members, qk.agents, qk.invites, qk.rooms].map((queryKey) =>
      qc.invalidateQueries({ queryKey }),
    ),
  );

export function useCreateDepartment() {
  const qc = useQueryClient();
  return useMutation({
    meta: { silentError: true },
    mutationFn: (input: CreateDepartmentInput) => api.post<Department>('/departments', input),
    onSuccess: () => refreshAll(qc),
  });
}

export function useUpdateDepartment() {
  const qc = useQueryClient();
  return useMutation({
    meta: { silentError: true },
    mutationFn: ({ id, ...patch }: UpdateDepartmentInput & { id: string }) =>
      api.patch<Department>(`/departments/${encodeURIComponent(id)}`, patch),
    onSuccess: () => refreshAll(qc),
  });
}

export function useDeleteDepartment() {
  const qc = useQueryClient();
  return useMutation({
    meta: { silentError: true },
    mutationFn: (id: string) => api.delete<null>(`/departments/${encodeURIComponent(id)}`),
    onSuccess: () => refreshAll(qc),
  });
}

export function useReorderDepartments() {
  const qc = useQueryClient();
  return useMutation({
    meta: { silentError: true },
    mutationFn: (ids: string[]) =>
      api.put<Department[]>('/departments/order', { ids } satisfies ReorderDepartmentsInput),
    // Show the new order at once; the refetch settles it (and rolls it back on an error).
    onMutate: (ids) => {
      qc.setQueryData<Department[]>(qk.departments, (old) =>
        old
          ? ids
              .map((id, rank) => {
                const d = old.find((x) => x.id === id);
                return d ? { ...d, rank } : null;
              })
              .filter((d): d is Department => d !== null)
          : old,
      );
    },
    onSettled: () => qc.invalidateQueries({ queryKey: qk.departments }),
  });
}

export function useSetMemberDepartment() {
  const qc = useQueryClient();
  return useMutation({
    meta: { silentError: true },
    mutationFn: ({ id, departmentId }: { id: string } & SetDepartmentInput) =>
      api.put<Member>(`/members/${encodeURIComponent(id)}/department`, {
        departmentId,
      } satisfies SetDepartmentInput),
    onSuccess: () => refreshAll(qc),
  });
}

/**
 * Own title goes through `PATCH /me` (any member may); someone else's through the
 * owner/admin route.
 */
export function useSetMemberTitle(self: boolean) {
  const qc = useQueryClient();
  return useMutation({
    meta: { silentError: true },
    mutationFn: async ({ id, title }: { id: string } & SetMemberTitleInput) => {
      if (self) {
        const session = await api.patch<Session>('/me', { title });
        qc.setQueryData(qk.session, session);
      } else {
        await api.put<Member>(`/members/${encodeURIComponent(id)}/title`, {
          title,
        } satisfies SetMemberTitleInput);
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.members }),
  });
}
