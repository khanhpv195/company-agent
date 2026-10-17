import {
  spanResult,
  type RunSpan,
  type Task,
  type TaskActiveRun,
  type TaskActivity,
  type TaskRun as TaskRunContract,
} from '@repo/shared';
import type { Assignment } from '../gateway/entities/assignment.entity';
import type { TaskActivityRow } from './entities/task-activity.entity';
import type { TaskRun } from './entities/task-run.entity';
import type { TaskEntity } from './entities/task.entity';

/** A task's assignee is an agent or a member; the contract exposes one id. */
export const assigneeIdOf = (row: Pick<TaskEntity, 'assigneeAgentId' | 'assigneeMemberId'>) =>
  row.assigneeAgentId ?? row.assigneeMemberId;

/** The run is active until the engine finalizes it; timing comes from its assignment. */
export const toActiveRun = (run: TaskRun, assignment: Assignment): TaskActiveRun => ({
  n: run.n,
  startedAt: (assignment.startedAt ?? assignment.createdAt).toISOString(),
  step: run.step,
  steps: run.steps,
  computerId: assignment.computerId,
});

/** Only for finalized runs (status and times are set). */
export const toTaskRun = (run: TaskRun): TaskRunContract => ({
  n: run.n,
  status: run.status!,
  durationSec: run.durationSec ?? 0,
  toolCalls: run.toolCalls ?? 0,
  at: (run.finalizedAt ?? new Date(0)).toISOString(),
  error: run.error,
});

export const toTaskActivity = (row: TaskActivityRow): TaskActivity => ({
  id: row.id,
  by: row.by,
  at: row.at.toISOString(),
  kind: row.kind,
  text: row.text,
  tone: row.tone,
});

export interface TaskParts {
  /** Finalized runs, newest first. */
  runs: TaskRunContract[];
  activeRun: TaskActiveRun | null;
  /** Oldest first. */
  activity: TaskActivity[];
}

export const toTask = (row: TaskEntity, parts: TaskParts): Task => ({
  id: row.id,
  title: row.title,
  description: row.description,
  status: row.status,
  assigneeId: assigneeIdOf(row),
  priority: row.priority,
  labels: row.labels,
  chatId: row.chatId,
  requiresReview: row.requiresReview,
  createdAt: row.createdAt.toISOString(),
  subtasks: row.subtasks.map(({ title, done }) => ({ title, done })),
  runs: parts.runs,
  activeRun: parts.activeRun,
  activity: parts.activity,
  output: row.output,
  blockedReason: row.blockedReason,
  error: row.error,
  rank: row.rank,
});

/** A finished run on the agent timeline. Spans cover the assignment's own start..end. */
export const toRunSpan = (
  run: Pick<TaskRun, 'status'>,
  assignment: Pick<Assignment, 'agentId' | 'startedAt' | 'createdAt' | 'endedAt'>,
  title: string,
  finalizedAt: Date | null,
): RunSpan => ({
  agentId: assignment.agentId,
  title,
  startedAt: (assignment.startedAt ?? assignment.createdAt).toISOString(),
  endedAt: (assignment.endedAt ?? finalizedAt ?? assignment.createdAt).toISOString(),
  result: spanResult(run.status!),
});
