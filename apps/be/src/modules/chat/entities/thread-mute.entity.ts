import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { Member } from '../../workspace/entities/member.entity';
import { ChatMessage } from './chat-message.entity';

/** A member muted a thread (identified by its root message). */
@Entity('thread_mutes')
export class ThreadMute {
  @PrimaryColumn({ name: 'member_id', type: 'uuid' })
  memberId: string;

  @ManyToOne(() => Member, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'member_id' })
  member: Member;

  @PrimaryColumn({ name: 'root_id', type: 'uuid' })
  rootId: string;

  @ManyToOne(() => ChatMessage, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'root_id' })
  root: ChatMessage;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt: Date;
}
