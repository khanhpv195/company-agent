import type {
  AuditEvent,
  AuthSessionInfo,
  ChangePasswordInput,
  CursorPageMeta,
  DeleteAccountInput,
  Session,
  UpdateProfileInput,
} from '@repo/shared';
import {
  queryOptions,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';
import { api, apiRequest, toSearchParams } from '../../lib/api-client';
import { clearTokens, getTokens } from '../../lib/auth-tokens';
import { qk } from '../../lib/query-keys';
import { useUi } from '../../stores/ui';

/** Plain toast helper (no agent/task link); `error` styles it as a failure. */
export function useNotify() {
  const show = useUi((s) => s.showToast);
  return useCallback(
    (text: string, error = false) =>
      show({ text, agentId: null, taskId: null, ...(error ? { tone: 'error' as const } : {}) }),
    [show],
  );
}

/** Signs out on the API (best effort), clears local tokens and caches, and goes to /login. */
export function useLogout() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  return useCallback(async () => {
    try {
      await api.post('/auth/logout', { refreshToken: getTokens()?.refreshToken });
    } catch {
      /* log out locally even if the API call fails */
    } finally {
      clearTokens();
    }
    qc.clear();
    await navigate({ to: '/login' });
  }, [qc, navigate]);
}

export const accountSessionsQuery = queryOptions({
  queryKey: qk.accountSessions,
  queryFn: () => api.get<AuthSessionInfo[]>('/me/sessions'),
});

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateProfileInput) => api.patch<Session>('/me', input),
    onSuccess: (session) => {
      qc.setQueryData(qk.session, session);
      // Other members' lists show this member's name and avatar color.
      void qc.invalidateQueries({ queryKey: qk.members });
    },
  });
}

export const useChangePassword = () =>
  useMutation({
    meta: { silentError: true },
    mutationFn: (input: ChangePasswordInput) => api.post<null>('/me/password', input),
  });

export function useRevokeSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<null>(`/me/sessions/${encodeURIComponent(id)}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.accountSessions }),
  });
}

export function useRevokeOtherSessions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<null>('/me/sessions/revoke-others'),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.accountSessions }),
  });
}

export const useDeleteAccount = () =>
  useMutation({
    meta: { silentError: true },
    mutationFn: (input: DeleteAccountInput) => api.delete<null>('/me', input),
  });

export interface AuditPage {
  events: AuditEvent[];
  nextCursor: string | null;
}

export const AUDIT_PAGE_SIZE = 50;

/** Newest-first audit log; `fetchNextPage` follows the opaque `meta.nextCursor`. */
export const useAuditEvents = () =>
  useInfiniteQuery({
    queryKey: qk.audit,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }): Promise<AuditPage> => {
      const res = await apiRequest<AuditEvent[], CursorPageMeta>(
        `/audit-events${toSearchParams({ before: pageParam, limit: AUDIT_PAGE_SIZE })}`,
      );
      return { events: res.data, nextCursor: res.meta?.nextCursor ?? null };
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

export const useAccountSessions = () => useQuery(accountSessionsQuery);
