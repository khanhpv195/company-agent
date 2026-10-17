import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { AgentSkill } from '@repo/shared';
import { Computer } from '../../computers/entities/computer.entity';
import { Workspace } from '../../workspace/entities/workspace.entity';

/** No status column: it is derived on read (computer online + open assignments). */
@Entity('agents')
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

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
