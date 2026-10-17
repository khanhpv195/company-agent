import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { Member } from '../../workspace/entities/member.entity';

/** When a member last read a chat; unread = messages of others created after it. */
@Entity('thread_reads')
export class ThreadRead {
  @PrimaryColumn({ name: 'member_id', type: 'uuid' })
  memberId: string;

  @ManyToOne(() => Member, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'member_id' })
  member: Member;

  @PrimaryColumn({ name: 'chat_id', type: 'uuid' })
  chatId: string;

  @Column({ name: 'last_read_at', type: 'timestamptz' })
  lastReadAt: Date;
}
