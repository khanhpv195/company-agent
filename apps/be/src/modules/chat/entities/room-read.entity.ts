import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { Member } from '../../workspace/entities/member.entity';
import { Room } from './room.entity';

/**
 * How far a member has read the main timeline of a room, by message `seq` (unread = messages of
 * others with a greater seq). `joinedSeq` is the room's last seq when the member joined (set by
 * the `room_members` insert trigger): threads the member never opened count only messages after it.
 */
@Entity('room_reads')
export class RoomRead {
  @PrimaryColumn({ name: 'member_id', type: 'uuid' })
  memberId: string;

  @ManyToOne(() => Member, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'member_id' })
  member: Member;

  @PrimaryColumn({ name: 'room_id', type: 'uuid' })
  roomId: string;

  @ManyToOne(() => Room, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'room_id' })
  room: Room;

  @Column({ name: 'last_read_seq', type: 'bigint', default: 0 })
  lastReadSeq: string;

  @Column({ name: 'joined_seq', type: 'bigint', default: 0 })
  joinedSeq: string;

  @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'now()' })
  updatedAt: Date;
}
