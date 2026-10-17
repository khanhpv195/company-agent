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
  UpdateDateColumn,
} from 'typeorm';
import type { MemberRole } from '@repo/shared';
import { Workspace } from './workspace.entity';

@Entity('members')
@Unique('UQ_members_email', ['email'])
@Check('CHK_members_email_lowercase', `"email" = lower(btrim("email"))`)
@Check('CHK_members_role', `"role" IN ('owner', 'admin', 'member')`)
export class Member {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId: string;

  @ManyToOne(() => Workspace, (workspace) => workspace.members, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workspace_id' })
  workspace: Workspace;

  @Column({ type: 'varchar' })
  name: string;

  /** Stored trimmed and lower-cased. */
  @Column({ type: 'varchar' })
  email: string;

  @Column({ name: 'password_hash', type: 'varchar', select: false })
  passwordHash: string;

  @Column({ type: 'varchar' })
  role: MemberRole;

  @Column({ type: 'varchar', nullable: true })
  color: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
