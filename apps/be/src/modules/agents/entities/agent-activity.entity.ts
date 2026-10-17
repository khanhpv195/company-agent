import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import type { AgentActivity as AgentActivityContract } from '@repo/shared';
import { Workspace } from '../../workspace/entities/workspace.entity';
import { Agent } from './agent.entity';

@Entity('agent_activity')
@Index('IDX_agent_activity_agent_at', ['agentId', 'at'])
export class AgentActivity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
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

  /** Contract field `where`; "where" is a reserved word in SQL, hence the column name. */
  @Column({ name: 'location', type: 'varchar' })
  location: string;

  @Column({ type: 'text' })
  request: string;

  @Column({ type: 'varchar' })
  status: AgentActivityContract['status'];

  @Column({ type: 'timestamptz' })
  at: Date;
}
