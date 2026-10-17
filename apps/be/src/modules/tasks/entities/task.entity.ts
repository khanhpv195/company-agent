import type { TaskPriority, TaskStatus, TaskSubtask } from '@repo/shared';
import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Agent } from '../../agents/entities/agent.entity';
import { Member } from '../../workspace/entities/member.entity';
import { Workspace } from '../../workspace/entities/workspace.entity';

/** `id` is the human key `AG-<n>`, unique per workspace (counter: `workspaces.task_seq`). */
@Entity('tasks')
@Index('IDX_tasks_workspace_status_rank', ['workspaceId', 'status', 'rank'])
@Check('CHK_tasks_status', `"status" IN ('backlog', 'todo', 'doing', 'review', 'done')`)
@Check('CHK_tasks_priority', `"priority" IN ('urgent', 'high', 'med', 'low')`)
@Check('CHK_tasks_single_assignee', `"assignee_agent_id" IS NULL OR "assignee_member_id" IS NULL`)
export class TaskEntity {
  @PrimaryColumn({ name: 'workspace_id', type: 'uuid' })
  workspaceId: string;

  @ManyToOne(() => Workspace, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workspace_id' })
  workspace: Workspace;

  @PrimaryColumn({ type: 'varchar' })
  id: string;

  @Column({ type: 'varchar' })
  title: string;

  @Column({ type: 'text', default: '' })
  description: string;

  @Column({ type: 'varchar', default: 'todo' })
  status: TaskStatus;

  @Column({ name: 'assignee_agent_id', type: 'uuid', nullable: true })
  assigneeAgentId: string | null;

  @ManyToOne(() => Agent, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'assignee_agent_id' })
  assigneeAgent: Agent | null;

  @Column({ name: 'assignee_member_id', type: 'uuid', nullable: true })
  assigneeMemberId: string | null;

  @ManyToOne(() => Member, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'assignee_member_id' })
  assigneeMember: Member | null;

  @Column({ type: 'varchar', default: 'med' })
  priority: TaskPriority;

  @Column({ type: 'text', array: true, default: () => `'{}'` })
  labels: string[];

  /** The assigning member's DM with the agent (or a thread id for seeded tasks). */
  @Column({ name: 'chat_id', type: 'varchar', nullable: true })
  chatId: string | null;

  @Column({ name: 'requires_review', type: 'boolean', default: true })
  requiresReview: boolean;

  @Column({ type: 'jsonb', default: () => `'[]'` })
  subtasks: TaskSubtask[];

  @Column({ type: 'text', nullable: true })
  output: string | null;

  @Column({ name: 'blocked_reason', type: 'text', nullable: true })
  blockedReason: string | null;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  /** Who created it: a run of this task acts on their behalf unless someone else starts it. */
  @Column({ name: 'created_by_member_id', type: 'uuid', nullable: true })
  createdByMemberId: string | null;

  @ManyToOne(() => Member, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'created_by_member_id' })
  createdByMember: Member | null;

  /** Manual order on the board; the engine renumbers it 0..n-1 when a task is reordered. */
  @Column({ type: 'double precision', default: 0 })
  rank: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
