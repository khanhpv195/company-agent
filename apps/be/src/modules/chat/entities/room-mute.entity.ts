import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { Member } from '../../workspace/entities/member.entity';
import { Room } from './room.entity';

/** A member muted a room: its unread is still tracked but flagged `muted`; only mentions notify. */
@Entity('room_mutes')
export class RoomMute {
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

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt: Date;
}
