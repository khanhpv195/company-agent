import type {
  CreateTaskInput,
  RunSpan,
  SchedulerState,
  Task,
  TaskStatus,
  UpdateTaskInput,
} from '@repo/shared';
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api-client';
import { HOUR } from '../../lib/format';
import { qk } from '../../lib/query-keys';
import { moveLocally } from './tasks.logic';

export const tasksQuery = queryOptions({
  queryKey: qk.tasks,
  queryFn: () => api.get<Task[]>('/tasks'),
});
export const useTasks = () => useQuery(tasksQuery);

/** Finished runs of the last 8 hours, for the per-agent timeline. */
export const useRunSpans = () =>
  useQuery({
    queryKey: qk.runSpans,
    queryFn: () =>
      api.get<RunSpan[]>(`/run-spans?since=${new Date(Date.now() - 8 * HOUR).toISOString()}`),
  }).data ?? [];

export const useScheduler = () =>
  useQuery({ queryKey: qk.scheduler, queryFn: () => api.get<SchedulerState>('/scheduler') }).data;

function useTaskMutation<TVars>(fn: (vars: TVars) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => qc.invalidateQueries({ queryKey: qk.tasks }),
  });
}

export function useTaskActions() {
  const qc = useQueryClient();
  const post = (path: string) => (id: string) => api.post<Task>(`/tasks/${id}/${path}`);

  const move = useMutation({
    mutationFn: (v: { id: string; status: TaskStatus; beforeId: string | null }) =>
      api.post<Task>(`/tasks/${v.id}/move`, { status: v.status, beforeId: v.beforeId }),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: qk.tasks });
      const prev = qc.getQueryData<Task[]>(qk.tasks);
      if (prev) qc.setQueryData(qk.tasks, moveLocally(prev, v.id, v.status, v.beforeId));
      return { prev };
    },
    onError: (_e, _v, ctx) => ctx?.prev && qc.setQueryData(qk.tasks, ctx.prev),
    onSettled: () => qc.invalidateQueries({ queryKey: qk.tasks }),
  });

  return {
    move,
    create: useTaskMutation((input: CreateTaskInput) => api.post<Task>('/tasks', input)),
    update: useTaskMutation((v: { id: string } & UpdateTaskInput) => {
      const { id, ...patch } = v;
      return api.patch<Task>(`/tasks/${id}`, patch);
    }),
    approve: useTaskMutation(post('approve')),
    revise: useTaskMutation((v: { id: string; note?: string }) =>
      api.post<Task>(`/tasks/${v.id}/revise`, { note: v.note }),
    ),
    stop: useTaskMutation(post('stop')),
    retry: useTaskMutation(post('retry')),
    runNow: useTaskMutation(post('run-now')),
    comment: useTaskMutation((v: { id: string; markdown: string }) =>
      api.post<Task>(`/tasks/${v.id}/comments`, { markdown: v.markdown }),
    ),
    setPaused: useMutation({
      mutationFn: (paused: boolean) => api.put<SchedulerState>('/scheduler', { paused }),
      onSuccess: (data) => qc.setQueryData(qk.scheduler, data),
    }),
  };
}
