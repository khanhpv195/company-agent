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
import { Room } from './room.entity';

export type AuthorKind = 'human' | 'agent' | 'external';
export type MessageStatus = 'streaming' | 'complete' | 'failed';

/**
 * A message of a room (channel, DM or connection inbox). Every room has one main timeline
 * (messages without `parentId`); a thread is the set of replies to one root message of that
 * timeline (`parentId` = the root, never a reply). A root may carry a `threadTitle`.
 */
@Entity('messages')
// (room_id, seq) serves `ORDER BY seq DESC LIMIT n` on a room timeline via a backward scan;
// TypeORM cannot declare DESC columns without schema drift.
@Index('IDX_messages_room_seq', ['roomId', 'seq'])
@Index('IDX_messages_parent_seq', ['parentId', 'seq'])
@Index('IDX_messages_assignment', ['assignmentId'])
// Idempotent send: one message per (room, author, client id).
@Index('UQ_messages_client_id', ['roomId', 'authorMemberId', 'clientMessageId'], {
  unique: true,
  where: `"client_message_id" IS NOT NULL`,
})
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

  @Column({ name: 'room_id', type: 'uuid' })
  roomId: string;

  @ManyToOne(() => Room, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'room_id' })
  room: Room;

  /** The root message of the thread this message replies to; null on the main timeline. */
  @Column({ name: 'parent_id', type: 'uuid', nullable: true })
  parentId: string | null;

  @ManyToOne(() => ChatMessage, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'parent_id' })
  parent: ChatMessage | null;

  /** Strict arrival order inside a room (equal timestamps cannot reorder it). */
  @Column({
    type: 'bigint',
    generated: 'identity',
    generatedIdentity: 'ALWAYS',
    insert: false,
    update: false,
  })
  seq: string;

  /** Title of the thread this root message starts (roots only). */
  @Column({ name: 'thread_title', type: 'varchar', nullable: true })
  threadTitle: string | null;

  /** Live (not deleted) replies of a root message. */
  @Column({ name: 'reply_count', type: 'int', default: 0 })
  replyCount: number;

  @Column({ name: 'last_reply_at', type: 'timestamptz', nullable: true })
  lastReplyAt: Date | null;

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

  @Column({ name: 'edited_at', type: 'timestamptz', nullable: true })
  editedAt: Date | null;

  /** Soft delete: the text is cleared and clients show a placeholder. */
  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;

  /** Chosen by the sending client so a retried send is idempotent. */
  @Column({ name: 'client_message_id', type: 'varchar', nullable: true })
  clientMessageId: string | null;

  /**
   * A placeholder root made by the RoomTimelines migration for a converted thread that had no
   * human or external first message. Not a real message: unread counts and previews skip it.
   */
  @Column({ name: 'system_root', type: 'boolean', default: false })
  systemRoot: boolean;

  @Column({ name: 'quote_message_id', type: 'uuid', nullable: true })
  quoteMessageId: string | null;

  @ManyToOne(() => ChatMessage, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'quote_message_id' })
  quote: ChatMessage | null;
}
