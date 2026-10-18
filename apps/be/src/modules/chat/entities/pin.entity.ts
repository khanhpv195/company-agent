import {
  Check,
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
import { Room } from './room.entity';

export type PinTargetType = 'room' | 'thread' | 'message';

/** A member's own pinned item (Kylon "priorities"): a room, a thread (root message id) or a message. */
@Entity('pins')
@Check('CHK_pins_target_type', `"target_type" IN ('room', 'thread', 'message')`)
@Index('UQ_pins_member_target', ['memberId', 'targetType', 'targetId'], { unique: true })
@Index('IDX_pins_member_position', ['memberId', 'position'])
export class Pin {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'member_id', type: 'uuid' })
  memberId: string;

  @ManyToOne(() => Member, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'member_id' })
  member: Member;

  @Index()
  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId: string;

  @ManyToOne(() => Workspace, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workspace_id' })
  workspace: Workspace;

  @Column({ name: 'target_type', type: 'varchar' })
  targetType: PinTargetType;

  /** The room id, the thread's root message id or the message id. */
  @Column({ name: 'target_id', type: 'uuid' })
  targetId: string;

  /** The room the target lives in (the pin disappears with the room). */
  @Column({ name: 'room_id', type: 'uuid' })
  roomId: string;

  @ManyToOne(() => Room, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'room_id' })
  room: Room;

  @Column({ type: 'int', default: 0 })
  position: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
