import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import type { WorkspacePlan } from '@repo/shared';
import { Member } from './member.entity';

@Entity('workspaces')
@Unique('UQ_workspaces_slug', ['slug'])
@Check('CHK_workspaces_plan', `"plan" IN ('free', 'pro', 'team')`)
export class Workspace {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar' })
  name: string;

  @Column({ type: 'varchar' })
  slug: string;

  @Column({ type: 'varchar', default: 'free' })
  plan: WorkspacePlan;

  @Column({ name: 'task_seq', type: 'int', default: 0 })
  taskSeq: number;

  @Column({ name: 'scheduler_paused', type: 'boolean', default: false })
  schedulerPaused: boolean;

  @Column({ name: 'onboarded_at', type: 'timestamptz', nullable: true })
  onboardedAt: Date | null;

  @OneToMany(() => Member, (member) => member.workspace)
  members: Member[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
