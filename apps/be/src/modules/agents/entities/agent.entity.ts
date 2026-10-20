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
import type { AgentSkill } from '@repo/shared';
import { Department } from '../../departments/entities/department.entity';
import { Computer } from '../../computers/entities/computer.entity';
import { Workspace } from '../../workspace/entities/workspace.entity';

/**
 * No status column: it is derived on read (computer online + open assignments).
 * Soft-deleted (`deleted_at`): TypeORM `find*` skips deleted rows, history rows keep the id.
 * Names are unique among live agents; the case-insensitive part is checked by the service
 * under the workspace lock (TypeORM cannot declare an expression index without drift).
 */
@Entity('agents')
@Index('UQ_agents_workspace_name_live', ['workspaceId', 'name'], {
  unique: true,
  where: '"deleted_at" IS NULL',
})
export class Agent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId: string;

  @ManyToOne(() => Workspace, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workspace_id' })
  workspace: Workspace;

  @Index()
  @Column({ name: 'computer_id', type: 'uuid' })
  computerId: string;

  @ManyToOne(() => Computer, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'computer_id' })
  computer: Computer;

  @Column({ type: 'varchar' })
  name: string;

  @Column({ type: 'int', default: 0 })
  avatar: number;

  @Column({ type: 'varchar', default: 'claude-code' })
  provider: string;

  @Column({ type: 'text', default: '' })
  persona: string;

  @Column({ type: 'varchar' })
  workdir: string;

  @Column({ name: 'max_turns', type: 'int', default: 40 })
  maxTurns: number;

  @Column({ type: 'jsonb', default: () => `'[]'` })
  skills: AgentSkill[];

  @Index()
  @Column({ name: 'department_id', type: 'uuid', nullable: true })
  departmentId: string | null;

  @ManyToOne(() => Department, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'department_id' })
  department: Department | null;

  /** Job title, at most 80 characters. */
  @Column({ type: 'varchar', length: 80, nullable: true })
  title: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
