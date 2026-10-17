import { placeBefore, type Task, type TaskPriority, type TaskStatus } from '@repo/shared';
import type { MessageKey, TFunction } from '../../i18n';

export const COLUMNS: {
  id: TaskStatus;
  nameKey: MessageKey;
  hintKey?: MessageKey;
  wip?: number;
}[] = [
  { id: 'backlog', nameKey: 'tasks.status.backlog', hintKey: 'tasks.hint.backlog' },
  { id: 'todo', nameKey: 'tasks.status.todo', hintKey: 'tasks.hint.todo' },
  { id: 'doing', nameKey: 'tasks.status.doing', wip: 4 },
  { id: 'review', nameKey: 'tasks.status.review', hintKey: 'tasks.hint.review' },
  { id: 'done', nameKey: 'tasks.status.done' },
];
export const statusName = (s: TaskStatus, t: TFunction) =>
  t(COLUMNS.find((c) => c.id === s)!.nameKey);

export const PRIORITY_KEYS: Record<TaskPriority, MessageKey> = {
  urgent: 'tasks.priority.urgent',
  high: 'tasks.priority.high',
  med: 'tasks.priority.med',
  low: 'tasks.priority.low',
};

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

/** Optimistic local version of a column move (the server may still queue or block it). */
export function moveLocally(
  tasks: Task[],
  id: string,
  status: TaskStatus,
  beforeId: string | null,
) {
  const t = tasks.find((x) => x.id === id);
  if (!t) return tasks;
  return placeBefore(tasks, { ...t, status }, beforeId).map((x, rank) =>
    x.rank === rank ? x : { ...x, rank },
  );
}
