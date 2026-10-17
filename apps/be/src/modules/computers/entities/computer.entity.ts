import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import type { ComputerStatus } from '@repo/shared';
import { Workspace } from '../../workspace/entities/workspace.entity';

@Entity('computers')
@Unique('UQ_computers_api_key_hash', ['apiKeyHash'])
export class Computer {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId: string;

  @ManyToOne(() => Workspace, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workspace_id' })
  workspace: Workspace;

  @Column({ type: 'varchar' })
  name: string;

  @Column({ type: 'varchar' })
  os: string;

  @Column({ type: 'varchar', default: 'offline' })
  status: ComputerStatus;

  @Column({ name: 'last_heartbeat_at', type: 'timestamptz' })
  lastHeartbeatAt: Date;

  @Column({ name: 'keep_awake', type: 'boolean', default: false })
  keepAwake: boolean;

  @Column({ name: 'cli_version', type: 'varchar' })
  cliVersion: string;

  /** sha256 hex of the daemon API key; the plaintext is only shown once at issue time. */
  @Column({ name: 'api_key_hash', type: 'char', length: 64, nullable: true, select: false })
  apiKeyHash: string | null;

  @Column({ type: 'boolean', default: false })
  simulated: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  /** Set when the computer is revoked: its key stopped working and it cannot be used again. */
  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt: Date | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
