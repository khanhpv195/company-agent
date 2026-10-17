import type { RoomIcon, RoomKind } from '@repo/shared';
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

/**
 * A channel (shared, holds threads) or a DM. A DM belongs to one member (`memberId`) and one
 * agent (`agentId`): DMs are per member, and nobody else can see or read them.
 */
@Entity('rooms')
@Check('CHK_rooms_kind', `"kind" IN ('dm', 'channel')`)
@Check('CHK_rooms_icon', `"icon" IN ('users', 'sparkles', 'hourglass', 'inbox')`)
// One DM per (member, agent); also what makes `ensureDm` race-safe.
@Index('UQ_rooms_dm_member_agent', ['memberId', 'agentId'], {
  unique: true,
  where: `"kind" = 'dm'`,
})
export class Room {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId: string;

  @ManyToOne(() => Workspace, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workspace_id' })
  workspace: Workspace;

  @Column({ type: 'varchar' })
  kind: RoomKind;

  @Column({ type: 'varchar' })
  name: string;

  @Column({ type: 'varchar', default: 'users' })
  icon: RoomIcon;

  @Column({ name: 'is_private', type: 'boolean', default: false })
  isPrivate: boolean;

  /** DM partner. */
  @Column({ name: 'agent_id', type: 'uuid', nullable: true })
  agentId: string | null;

  @ManyToOne(() => Agent, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'agent_id' })
  agent: Agent | null;

  /** DM owner. */
  @Column({ name: 'member_id', type: 'uuid', nullable: true })
  memberId: string | null;

  @ManyToOne(() => Member, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'member_id' })
  member: Member | null;

  /** Set by the connections phase for inbox rooms. */
  @Column({ name: 'connection_id', type: 'varchar', nullable: true })
  connectionId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
