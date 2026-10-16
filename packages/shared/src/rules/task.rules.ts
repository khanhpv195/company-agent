import type {
  RunSpan,
  Task,
  TaskPriority,
  TaskRunStatus,
  TaskStatus,
  TaskStep,
} from '../interfaces/task.interface';

/**
 * Pure task rules shared by the API and the desktop app (and its mock backend).
 * No I/O, timers or randomness: callers pass plain data in and get plain data back.
 */

/** Lower runs first. */
export const PRIORITY_RANK: Record<TaskPriority, number> = { urgent: 0, high: 1, med: 2, low: 3 };

export const STATUS_NAME: Record<TaskStatus, string> = {
  backlog: 'Backlog',
  todo: 'Cần làm',
  doing: 'Đang làm',
  review: 'Chờ duyệt',
  done: 'Xong',
};

export const PRIORITY_NAME: Record<TaskPriority, string> = {
  urgent: 'Khẩn',
  high: 'Cao',
  med: 'Trung bình',
  low: 'Thấp',
};

/** The task an agent is running right now (an agent runs at most one). */
export const runningOf = <T extends Task>(tasks: T[], agentId: string): T | undefined =>
  tasks.find((t) => t.assigneeId === agentId && t.activeRun);

/** An agent's queue: its "Cần làm" tasks, highest priority first, then board order. */
export const queueOf = <T extends Task>(tasks: T[], agentId: string): T[] =>
  tasks
    .filter((t) => t.assigneeId === agentId && t.status === 'todo')
    .sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.rank - b.rank);

/** Queue entries the agent will actually pick up (not blocked, not failed). */
export const pickableOf = <T extends Task>(tasks: T[], agentId: string): T[] =>
  queueOf(tasks, agentId).filter((t) => !t.blockedReason && !t.error);

/** The step a running task is on (clamped to the last one), or null when not running. */
export const currentStep = (t: Pick<Task, 'activeRun'>): TaskStep | null => {
  const run = t.activeRun;
  if (!run || !run.steps.length) return null;
  return run.steps[Math.min(run.step, run.steps.length - 1)];
};

/** A rank that sorts before every task (new tasks and "run now" go first). */
export const firstRank = (tasks: Pick<Task, 'rank'>[]) =>
  Math.min(0, ...tasks.map((t) => t.rank)) - 1;

/**
 * Board order after placing `item` before `beforeId` (or at the end when missing).
 * Returns the tasks sorted by rank with `item` replacing its old entry; index = new rank.
 */
export function placeBefore<T extends Pick<Task, 'id' | 'rank'>>(
  tasks: T[],
  item: T,
  beforeId: string | null | undefined,
): T[] {
  const list = [...tasks].sort((a, b) => a.rank - b.rank).filter((x) => x.id !== item.id);
  const at = beforeId ? list.findIndex((x) => x.id === beforeId) : -1;
  list.splice(at >= 0 ? at : list.length, 0, item);
  return list;
}

/** Where a successful run leaves its task. */
export const statusAfterRun = (t: Pick<Task, 'requiresReview'>): TaskStatus =>
  t.requiresReview ? 'review' : 'done';

/** How a finished run shows on the agent timeline. */
export const spanResult = (status: TaskRunStatus): RunSpan['result'] =>
  status === 'completed' ? 'done' : status === 'failed' ? 'fail' : 'cancel';

/** Subtasks ticked off so far, proportional to the run's progress. */
export const subtasksDue = (step: number, steps: number, subtasks: number) =>
  Math.floor((step / steps) * subtasks);
