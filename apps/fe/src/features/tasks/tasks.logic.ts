import type { Task, TaskPriority, TaskStatus } from '@repo/shared';

export const COLUMNS: { id: TaskStatus; name: string; hint?: string; wip?: number }[] = [
  { id: 'backlog', name: 'Backlog', hint: 'Ý tưởng, chưa lên lịch' },
  { id: 'todo', name: 'Cần làm', hint: 'Agent sẽ tự nhận khi rảnh' },
  { id: 'doing', name: 'Đang làm', wip: 4 },
  { id: 'review', name: 'Chờ duyệt', hint: 'Agent xong, chờ người duyệt' },
  { id: 'done', name: 'Xong' },
];
export const statusName = (s: TaskStatus) => COLUMNS.find((c) => c.id === s)!.name;

export const PRIORITIES: Record<TaskPriority, string> = {
  urgent: 'Khẩn',
  high: 'Cao',
  med: 'Trung bình',
  low: 'Thấp',
};
export const PRIORITY_RANK: Record<TaskPriority, number> = { urgent: 0, high: 1, med: 2, low: 3 };

export const LABEL_COLORS: Record<string, string> = {
  email: '#c98a1b',
  research: '#7a5a1f',
  fe: '#5157b0',
  be: '#3d8a6a',
  infra: '#c04a7a',
  zalo: '#0068ff',
  docs: '#8a8a85',
  data: '#1f6f7a',
};

/** Timeline colors; validated together (dataviz validator, all pairs). */
export const C_DONE = '#6a7f2a';
export const C_FAIL = '#c04a7a';
export const C_RUN = '#3a74b8';
export const C_CANCEL = '#b5b3ac';

export const runningOf = (tasks: Task[], agentId: string) =>
  tasks.find((t) => t.assigneeId === agentId && t.activeRun);

/** An agent's queue: its "Cần làm" tasks, highest priority first, then board order. */
export const queueOf = (tasks: Task[], agentId: string) =>
  tasks
    .filter((t) => t.assigneeId === agentId && t.status === 'todo')
    .sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.rank - b.rank);

/** Queue entries the agent will actually pick up (not blocked, not failed). */
export const pickableOf = (tasks: Task[], agentId: string) =>
  queueOf(tasks, agentId).filter((t) => !t.blockedReason && !t.error);

export interface TaskFilters {
  q: string;
  who: string | null;
  prio: TaskPriority | '';
}

export function filterTasks(tasks: Task[], f: TaskFilters) {
  const q = f.q.trim().toLowerCase();
  return tasks.filter(
    (t) =>
      (!f.who || t.assigneeId === f.who) &&
      (!f.prio || t.priority === f.prio) &&
      (!q || `${t.id} ${t.title}`.toLowerCase().includes(q)),
  );
}

export const currentStep = (t: Task) => {
  const run = t.activeRun;
  if (!run || !run.steps.length) return null;
  return run.steps[Math.min(run.step, run.steps.length - 1)];
};

/** Optimistic local version of a column move (the server may still queue or block it). */
export function moveLocally(
  tasks: Task[],
  id: string,
  status: TaskStatus,
  beforeId: string | null,
) {
  const list = [...tasks].sort((a, b) => a.rank - b.rank);
  const i = list.findIndex((t) => t.id === id);
  if (i < 0) return tasks;
  const [t] = list.splice(i, 1);
  const at = beforeId ? list.findIndex((x) => x.id === beforeId) : -1;
  list.splice(at >= 0 ? at : list.length, 0, { ...t, status });
  return list.map((x, rank) => (x.rank === rank ? x : { ...x, rank }));
}
