import type { RoomMemberRole } from '@repo/shared';
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
import { Agent } from '../../agents/entities/agent.entity';
import { Member } from '../../workspace/entities/member.entity';
import { Workspace } from '../../workspace/entities/workspace.entity';
import { Room } from './room.entity';

/**
 * Who belongs to a channel: a human member or an agent (exactly one of the two). Channel
 * visibility, @mention wake-ups and realtime audiences all derive from these rows. DMs have
 * none (their `member_id`/`agent_id` on the room are the membership).
 */
@Entity('room_members')
@Check('CHK_room_members_one_party', `("member_id" IS NULL) <> ("agent_id" IS NULL)`)
@Check('CHK_room_members_role', `"role" IN ('owner', 'member')`)
@Index('UQ_room_members_room_member', ['roomId', 'memberId'], {
  unique: true,
  where: `"member_id" IS NOT NULL`,
})
@Index('UQ_room_members_room_agent', ['roomId', 'agentId'], {
  unique: true,
  where: `"agent_id" IS NOT NULL`,
})
export class RoomMember {
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

  @Index('IDX_room_members_member')
  @Column({ name: 'member_id', type: 'uuid', nullable: true })
  memberId: string | null;

  @ManyToOne(() => Member, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'member_id' })
  member: Member | null;

  @Column({ name: 'agent_id', type: 'uuid', nullable: true })
  agentId: string | null;

  @ManyToOne(() => Agent, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'agent_id' })
  agent: Agent | null;

  @Column({ type: 'varchar', default: 'member' })
  role: RoomMemberRole;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
