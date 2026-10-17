import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { Agent } from '../../agents/entities/agent.entity';

/**
 * The Claude Code session an agent keeps per conversation: `key` is the chat id for chats and
 * `task:<taskId>` for tasks. A row exists once a run has reported its session id; from then on
 * the next run of that conversation resumes it.
 */
@Entity('agent_sessions')
export class AgentSession {
  @PrimaryColumn({ name: 'agent_id', type: 'uuid' })
  agentId: string;

  @ManyToOne(() => Agent, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'agent_id' })
  agent: Agent;

  @PrimaryColumn({ type: 'varchar' })
  key: string;

  @Column({ name: 'session_id', type: 'uuid' })
  sessionId: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
