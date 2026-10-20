import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Member } from '../../workspace/entities/member.entity';
import { Workspace } from '../../workspace/entities/workspace.entity';

/**
 * A skill of the workspace library (a SKILL.md). Soft-deleted (`deleted_at`): slugs are unique
 * among live skills only, so a deleted slug can be reused. `version` is bumped, and a
 * `skill_versions` row written, on every name, description or content change.
 */
@Entity('skills')
@Index('UQ_skills_workspace_slug_live', ['workspaceId', 'slug'], {
  unique: true,
  where: '"deleted_at" IS NULL',
})
export class Skill {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId: string;

  @ManyToOne(() => Workspace, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workspace_id' })
  workspace: Workspace;

  @Column({ type: 'varchar', length: 64 })
  slug: string;

  @Column({ type: 'varchar', length: 80 })
  name: string;

  @Column({ type: 'varchar', length: 500 })
  description: string;

  @Column({ type: 'text' })
  content: string;

  /** The catalog template it came from (statistics only). */
  @Column({ name: 'template_id', type: 'varchar', nullable: true })
  templateId: string | null;

  @Column({ type: 'int', default: 1 })
  version: number;

  @Column({ name: 'created_by_member_id', type: 'uuid', nullable: true })
  createdByMemberId: string | null;

  @ManyToOne(() => Member, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'created_by_member_id' })
  createdBy: Member | null;

  @Column({ name: 'updated_by_member_id', type: 'uuid', nullable: true })
  updatedByMemberId: string | null;

  @ManyToOne(() => Member, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'updated_by_member_id' })
  updatedBy: Member | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
