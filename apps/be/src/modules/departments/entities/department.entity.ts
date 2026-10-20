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
import type { DepartmentIcon } from '@repo/shared';
import { Room } from '../../chat/entities/room.entity';
import { Workspace } from '../../workspace/entities/workspace.entity';

/**
 * Soft-deleted (`deleted_at`): the room outlives it. Names are unique among live departments,
 * ignoring case: `UQ_departments_workspace_name_ci` is `(workspace_id, lower(name)) WHERE
 * deleted_at IS NULL`, created by hand in the migration because TypeORM cannot declare an
 * expression index; `synchronize: false` keeps it out of the drift diff.
 */
@Entity('departments')
@Index('UQ_departments_workspace_name_ci', { synchronize: false })
export class Department {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId: string;

  @ManyToOne(() => Workspace, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workspace_id' })
  workspace: Workspace;

  @Column({ type: 'varchar', length: 60 })
  name: string;

  @Column({ type: 'varchar', default: 'users' })
  icon: DepartmentIcon;

  @Column({ type: 'int', default: 0 })
  rank: number;

  /** The department's public channel. */
  @Column({ name: 'room_id', type: 'uuid', nullable: true })
  roomId: string | null;

  @ManyToOne(() => Room, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'room_id' })
  room: Room | null;

  /** The catalog template it came from (statistics only). */
  @Column({ name: 'template_id', type: 'varchar', nullable: true })
  templateId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
