import type { TaskRunStatus } from '@repo/shared';

/** Internal domain events of the task engine (never sent to clients). */
export const TASK_RUN_ENDED_EVENT = 'task.run.ended';
export const TASK_APPROVED_EVENT = 'task.approved';

export interface TaskRunEndedPayload {
  workspaceId: string;
  taskId: string;
  title: string;
  agentId: string;
  status: TaskRunStatus;
  durationSec: number;
}

export interface TaskApprovedPayload {
  workspaceId: string;
  taskId: string;
  title: string;
  /** The assigned agent, when the task has one. */
  agentId: string | null;
  /** Member who approved. */
  by: string | null;
}
