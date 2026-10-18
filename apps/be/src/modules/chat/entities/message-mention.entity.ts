import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ChatMessage } from './chat-message.entity';

export type MentionKind = 'member' | 'agent' | 'here';

/**
 * A resolved @mention of a message, written when the message is sent or edited: a member, an
 * agent, or `here` (@here / @room: every human of the room). Drives mention counts and the @me feed.
 */
@Entity('message_mentions')
@Check('CHK_message_mentions_kind', `"kind" IN ('member', 'agent', 'here')`)
@Index('IDX_message_mentions_message', ['messageId'])
@Index('IDX_message_mentions_member', ['memberId', 'messageId'])
export class MessageMention {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'message_id', type: 'uuid' })
  messageId: string;

  @ManyToOne(() => ChatMessage, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'message_id' })
  message: ChatMessage;

  @Column({ type: 'varchar' })
  kind: MentionKind;

  @Column({ name: 'member_id', type: 'uuid', nullable: true })
  memberId: string | null;

  @Column({ name: 'agent_id', type: 'uuid', nullable: true })
  agentId: string | null;
}
