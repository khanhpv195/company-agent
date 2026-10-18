import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { Member } from '../../workspace/entities/member.entity';

/**
 * How far a member has read a thread, by message `seq` (the root and its replies); unread =
 * messages of others with a greater seq. `chatId` is the thread's root message id (the legacy
 * "chat id"); it has no foreign key, rows of a deleted room are removed with it.
 */
@Entity('thread_reads')
export class ThreadRead {
  @PrimaryColumn({ name: 'member_id', type: 'uuid' })
  memberId: string;

  @ManyToOne(() => Member, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'member_id' })
  member: Member;

  @PrimaryColumn({ name: 'chat_id', type: 'uuid' })
  chatId: string;

  @Column({ name: 'last_read_seq', type: 'bigint', default: 0 })
  lastReadSeq: string;

  @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'now()' })
  updatedAt: Date;
}
