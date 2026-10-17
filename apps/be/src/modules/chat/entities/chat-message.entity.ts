import type { MessageDraft } from '@repo/shared';
import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Agent } from '../../agents/entities/agent.entity';
import { Assignment } from '../../gateway/entities/assignment.entity';
import { Member } from '../../workspace/entities/member.entity';
import { Workspace } from '../../workspace/entities/workspace.entity';

export type ChatKind = 'dm' | 'thread';
export type AuthorKind = 'human' | 'agent' | 'external';
export type MessageStatus = 'streaming' | 'complete' | 'failed';

/**
 * A message of a DM room or a channel thread. `chatId` is polymorphic (a DM room id or a
 * thread id, told apart by `chatKind`), so it carries no foreign key.
 */
@Entity('messages')
@Index('IDX_messages_chat_created', ['chatId', 'createdAt'])
// (chat_id, seq) serves `ORDER BY seq DESC LIMIT n` and DISTINCT ON via a backward scan;
// TypeORM cannot declare DESC columns without schema drift.
@Index('IDX_messages_chat_seq', ['chatId', 'seq'])
@Index('IDX_messages_assignment', ['assignmentId'])
@Check('CHK_messages_chat_kind', `"chat_kind" IN ('dm', 'thread')`)
@Check('CHK_messages_author_kind', `"author_kind" IN ('human', 'agent', 'external')`)
@Check('CHK_messages_status', `"status" IN ('streaming', 'complete', 'failed')`)
export class ChatMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId: string;

  @ManyToOne(() => Workspace, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workspace_id' })
  workspace: Workspace;

  @Column({ name: 'chat_id', type: 'uuid' })
  chatId: string;

  /** Strict arrival order inside a chat (equal timestamps cannot reorder it). */
  @Column({
    type: 'bigint',
    generated: 'identity',
    generatedIdentity: 'ALWAYS',
    insert: false,
    update: false,
  })
  seq: string;

  @Column({ name: 'chat_kind', type: 'varchar' })
  chatKind: ChatKind;

  @Column({ name: 'author_kind', type: 'varchar' })
  authorKind: AuthorKind;

  @Column({ name: 'author_member_id', type: 'uuid', nullable: true })
  authorMemberId: string | null;

  @ManyToOne(() => Member, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'author_member_id' })
  authorMember: Member | null;

  @Column({ name: 'author_agent_id', type: 'uuid', nullable: true })
  authorAgentId: string | null;

  @ManyToOne(() => Agent, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'author_agent_id' })
  authorAgent: Agent | null;

  @Column({ name: 'external_connection_id', type: 'varchar', nullable: true })
  externalConnectionId: string | null;

  @Column({ name: 'external_name', type: 'varchar', nullable: true })
  externalName: string | null;

  @Column({ type: 'varchar', default: 'complete' })
  status: MessageStatus;

  @Column({ type: 'text', default: '' })
  markdown: string;

  /** The agent run that writes this message (agent replies only). */
  @Column({ name: 'assignment_id', type: 'uuid', nullable: true })
  assignmentId: string | null;

  @ManyToOne(() => Assignment, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'assignment_id' })
  assignment: Assignment | null;

  @Column({ type: 'jsonb', nullable: true })
  draft: MessageDraft | null;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
