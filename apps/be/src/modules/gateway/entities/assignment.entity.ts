import type { ToolCall } from '@repo/shared';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Agent } from '../../agents/entities/agent.entity';
import { Computer } from '../../computers/entities/computer.entity';
import { Workspace } from '../../workspace/entities/workspace.entity';

export type AssignmentSourceKind = 'chat' | 'task';
export type AssignmentStatus =
  'pending' | 'offered' | 'claimed' | 'running' | 'completed' | 'failed' | 'expired' | 'cancelled';

export const TERMINAL_STATUSES: readonly AssignmentStatus[] = [
  'completed',
  'failed',
  'expired',
  'cancelled',
];
/** Statuses in which a daemon holds the assignment (lease, heartbeat, result). */
export const BUSY_STATUSES: readonly AssignmentStatus[] = ['claimed', 'running'];
/** Statuses in which a task assignment makes its agent "working" (offered counts). */
export const TASK_WORKING_STATUSES: readonly AssignmentStatus[] = ['offered', 'claimed', 'running'];

/** Work handed to an agent's computer, shared by chat replies and task runs. */
@Entity('assignments')
@Index('IDX_assignments_workspace_status', ['workspaceId', 'status'])
@Index('IDX_assignments_agent_status', ['agentId', 'status'])
@Index('IDX_assignments_computer_status', ['computerId', 'status'])
@Index('IDX_assignments_source', ['sourceKind', 'sourceId'])
@Index('IDX_assignments_workspace_ended', ['workspaceId', 'endedAt'])
// An agent runs at most one task at a time (chat replies are not limited). An offered task
// run already occupies the agent, so the violation surfaces at `offer`, not at `claim`.
@Index('UQ_assignments_one_task_run_per_agent', ['agentId'], {
  unique: true,
  where: `"source_kind" = 'task' AND "status" IN ('offered', 'claimed', 'running')`,
})
export class Assignment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId: string;

  @ManyToOne(() => Workspace, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workspace_id' })
  workspace: Workspace;

  @Column({ name: 'agent_id', type: 'uuid' })
  agentId: string;

  @ManyToOne(() => Agent, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'agent_id' })
  agent: Agent;

  @Column({ name: 'computer_id', type: 'uuid' })
  computerId: string;

  @ManyToOne(() => Computer, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'computer_id' })
  computer: Computer;

  @Column({ name: 'source_kind', type: 'varchar' })
  sourceKind: AssignmentSourceKind;

  @Column({ name: 'source_id', type: 'varchar' })
  sourceId: string;

  @Column({ type: 'varchar', default: 'pending' })
  status: AssignmentStatus;

  @Column({ type: 'int', default: 0 })
  attempt: number;

  @Column({ type: 'varchar', nullable: true })
  activation: string | null;

  @Column({ name: 'session_key', type: 'varchar', nullable: true })
  sessionKey: string | null;

  @Column({ name: 'lease_expires_at', type: 'timestamptz', nullable: true })
  leaseExpiresAt: Date | null;

  @Column({ name: 'tool_calls', type: 'int', default: 0 })
  toolCalls: number;

  /** Tool calls reported with an id (chat replies), upserted by id; `toolCalls` counts them. */
  @Column({ name: 'tool_log', type: 'jsonb', default: () => `'[]'` })
  toolLog: ToolCall[];

  /** Conversation turns the run took (chat replies). */
  @Column({ type: 'int', default: 0 })
  turns: number;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt: Date | null;

  @Column({ name: 'ended_at', type: 'timestamptz', nullable: true })
  endedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
