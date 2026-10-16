export type TaskStatus = 'backlog' | 'todo' | 'doing' | 'review' | 'done';
export type TaskPriority = 'urgent' | 'high' | 'med' | 'low';
export type TaskRunStatus = 'completed' | 'failed' | 'cancelled' | 'expired';

export interface TaskSubtask {
  title: string;
  done: boolean;
}

export interface TaskStep {
  tool: string;
  input: string;
}

/** The run an agent is executing right now. One agent has at most one. */
export interface TaskActiveRun {
  n: number;
  startedAt: string;
  step: number;
  steps: TaskStep[];
  computerId: string;
}

export interface TaskRun {
  n: number;
  status: TaskRunStatus;
  durationSec: number;
  toolCalls: number;
  at: string;
  error: string | null;
}

export interface TaskActivity {
  id: string;
  /** Member or agent id; null for the system. */
  by: string | null;
  at: string;
  kind: 'event' | 'comment';
  /** Inline markdown. */
  text: string;
  tone: 'normal' | 'error';
}

export interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  /** Agent or member id. */
  assigneeId: string | null;
  priority: TaskPriority;
  labels: string[];
  chatId: string | null;
  requiresReview: boolean;
  createdAt: string;
  subtasks: TaskSubtask[];
  runs: TaskRun[];
  activeRun: TaskActiveRun | null;
  activity: TaskActivity[];
  output: string | null;
  blockedReason: string | null;
  error: string | null;
  /** Manual order inside a column. */
  rank: number;
}

/** A finished run on an agent's timeline. */
export interface RunSpan {
  agentId: string;
  title: string;
  startedAt: string;
  endedAt: string;
  result: 'done' | 'fail' | 'cancel';
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  assigneeId?: string | null;
  priority?: TaskPriority;
  status?: TaskStatus;
  requiresReview?: boolean;
}

export interface UpdateTaskInput {
  assigneeId?: string | null;
  priority?: TaskPriority;
  requiresReview?: boolean;
  subtasks?: TaskSubtask[];
}

export interface MoveTaskInput {
  status: TaskStatus;
  /** Place the task before this one in the column. */
  beforeId?: string | null;
}

export interface CommentInput {
  markdown: string;
}

export interface SchedulerState {
  /** When paused, agents neither progress nor pick up queued tasks. */
  paused: boolean;
}
