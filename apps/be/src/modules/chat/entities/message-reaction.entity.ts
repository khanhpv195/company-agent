import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Member } from '../../workspace/entities/member.entity';
import { Workspace } from '../../workspace/entities/workspace.entity';
import { ChatMessage } from './chat-message.entity';

/** One emoji reaction of one member to one message (unicode emoji only, see `reaction-key.ts`). */
@Entity('message_reactions')
@Index('UQ_message_reactions_message_member_key', ['messageId', 'memberId', 'key'], {
  unique: true,
})
export class MessageReaction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId: string;

  @ManyToOne(() => Workspace, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workspace_id' })
  workspace: Workspace;

  @Column({ name: 'message_id', type: 'uuid' })
  messageId: string;

  @ManyToOne(() => ChatMessage, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'message_id' })
  message: ChatMessage;

  @Column({ name: 'member_id', type: 'uuid' })
  memberId: string;

  @ManyToOne(() => Member, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'member_id' })
  member: Member;

  @Column({ type: 'varchar', length: 32 })
  key: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
