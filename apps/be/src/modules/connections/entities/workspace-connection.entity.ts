import type { ConnectionProvider, ReplyMode } from '@repo/shared';
import { Check, Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { Agent } from '../../agents/entities/agent.entity';
import { Room } from '../../chat/entities/room.entity';
import { Workspace } from '../../workspace/entities/workspace.entity';

/**
 * A workspace's state for one provider of the catalog. Rows are created lazily on the first
 * connect; a provider without a row is "off" with the catalog defaults. `rooms.connection_id`
 * and `threads.connection_id` hold the provider id (scoped by the room's own workspace).
 */
@Entity('workspace_connections')
@Check('CHK_workspace_connections_provider', `"provider" IN ('zalo', 'facebook', 'gmail')`)
@Check('CHK_workspace_connections_status', `"status" IN ('on', 'off')`)
@Check('CHK_workspace_connections_mode', `"mode" IN ('draft', 'auto')`)
export class WorkspaceConnection {
  @PrimaryColumn({ name: 'workspace_id', type: 'uuid' })
  workspaceId: string;

  @ManyToOne(() => Workspace, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workspace_id' })
  workspace: Workspace;

  @PrimaryColumn({ type: 'varchar' })
  provider: ConnectionProvider;

  @Column({ type: 'varchar', default: 'off' })
  status: 'on' | 'off';

  /** The connected external account (page, OA, mailbox). */
  @Column({ type: 'varchar', nullable: true })
  account: string | null;

  @Column({ name: 'room_name', type: 'varchar' })
  roomName: string;

  @Column({ name: 'room_id', type: 'uuid', nullable: true })
  roomId: string | null;

  @ManyToOne(() => Room, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'room_id' })
  room: Room | null;

  @Column({ name: 'agent_id', type: 'uuid', nullable: true })
  agentId: string | null;

  @ManyToOne(() => Agent, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'agent_id' })
  agent: Agent | null;

  @Column({ type: 'varchar', default: 'draft' })
  mode: ReplyMode;

  @Column({ name: 'connected_at', type: 'timestamptz', nullable: true })
  connectedAt: Date | null;
}
