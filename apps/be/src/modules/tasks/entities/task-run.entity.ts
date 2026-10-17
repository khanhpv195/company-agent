import type { TaskRunStatus, TaskStep } from '@repo/shared';
import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Assignment } from '../../gateway/entities/assignment.entity';
import { Workspace } from '../../workspace/entities/workspace.entity';
import { TaskEntity } from './task.entity';

/**
 * One run of a task by an agent. Active while `finalizedAt` is null; the assignment holds
 * the lease and timing, this row the tool script and its progress.
 */
@Entity('task_runs')
@Unique('UQ_task_runs_assignment', ['assignmentId'])
@Unique('UQ_task_runs_task_n', ['workspaceId', 'taskId', 'n'])
@Index('IDX_task_runs_workspace_finalized', ['workspaceId', 'finalizedAt'])
export class TaskRun {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId: string;

  @ManyToOne(() => Workspace, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workspace_id' })
  workspace: Workspace;

  @Column({ name: 'task_id', type: 'varchar' })
  taskId: string;

  @ManyToOne(() => TaskEntity, { onDelete: 'CASCADE' })
  @JoinColumn([
    { name: 'workspace_id', referencedColumnName: 'workspaceId' },
    { name: 'task_id', referencedColumnName: 'id' },
  ])
  task: TaskEntity;

  /**
   * Note: the cascade means deleting an agent (or computer) deletes its assignments and, with
   * them, the run history of its tasks. There is no agent deletion today; if it is ever added,
   * decide first whether that history must be kept (archive the agent instead).
   */
  @Column({ name: 'assignment_id', type: 'uuid' })
  assignmentId: string;

  @ManyToOne(() => Assignment, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'assignment_id' })
  assignment: Assignment;

  @Column({ type: 'int' })
  n: number;

  @Column({ type: 'int', default: 0 })
  step: number;

  @Column({ type: 'jsonb', default: () => `'[]'` })
  steps: TaskStep[];

  @Column({ type: 'varchar', nullable: true })
  status: TaskRunStatus | null;

  @Column({ name: 'duration_sec', type: 'int', nullable: true })
  durationSec: number | null;

  @Column({ name: 'tool_calls', type: 'int', nullable: true })
  toolCalls: number | null;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @Column({ name: 'finalized_at', type: 'timestamptz', nullable: true })
  finalizedAt: Date | null;
}
