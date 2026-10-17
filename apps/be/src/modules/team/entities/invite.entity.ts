import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import type { AssignableRole } from '@repo/shared';
import { Member } from '../../workspace/entities/member.entity';
import { Workspace } from '../../workspace/entities/workspace.entity';

@Entity('invites')
@Unique('UQ_invites_token_hash', ['tokenHash'])
@Check('CHK_invites_role', `"role" IN ('admin', 'member')`)
// One pending invite per address and workspace; a new one revokes the old first.
@Index('UQ_invites_pending_email', ['workspaceId', 'email'], {
  unique: true,
  where: '"accepted_at" IS NULL AND "revoked_at" IS NULL',
})
export class Invite {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId: string;

  @ManyToOne(() => Workspace, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workspace_id' })
  workspace: Workspace;

  /** Stored trimmed and lower-cased. */
  @Column({ type: 'varchar' })
  email: string;

  @Column({ type: 'varchar' })
  role: AssignableRole;

  /** sha256 of the raw token; the raw token only exists in the mail and the create response. */
  @Column({ name: 'token_hash', type: 'varchar' })
  tokenHash: string;

  @Column({ name: 'invited_by', type: 'uuid', nullable: true })
  invitedBy: string | null;

  @ManyToOne(() => Member, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'invited_by' })
  inviter: Member | null;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @Column({ name: 'accepted_at', type: 'timestamptz', nullable: true })
  acceptedAt: Date | null;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
