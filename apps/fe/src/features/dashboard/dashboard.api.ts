import type { DashboardSummary } from '@repo/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api-client';
import { qk } from '../../lib/query-keys';

export const useDashboard = () =>
  useQuery({ queryKey: qk.dashboard, queryFn: () => api.get<DashboardSummary>('/dashboard') }).data;

export const useResolveAttention = () =>
  useMutation({ mutationFn: (id: string) => api.post(`/dashboard/attention/${id}/resolve`) });
