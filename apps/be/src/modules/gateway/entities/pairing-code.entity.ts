import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Member } from '../../workspace/entities/member.entity';
import { Workspace } from '../../workspace/entities/workspace.entity';

/**
 * A one-time code a member shows to `agent connect`. Only its sha256 is stored; it lives
 * 10 minutes and is consumed atomically by the first pairing that presents it.
 */
@Entity('pairing_codes')
@Index('UQ_pairing_codes_code_hash', ['codeHash'], { unique: true })
export class PairingCode {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId: string;

  @ManyToOne(() => Workspace, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workspace_id' })
  workspace: Workspace;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy: string | null;

  @ManyToOne(() => Member, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'created_by' })
  creator: Member | null;

  @Column({ name: 'code_hash', type: 'char', length: 64 })
  codeHash: string;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @Column({ name: 'used_at', type: 'timestamptz', nullable: true })
  usedAt: Date | null;
}
