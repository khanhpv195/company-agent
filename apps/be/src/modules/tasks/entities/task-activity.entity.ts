import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Workspace } from '../../workspace/entities/workspace.entity';
import { TaskEntity } from './task.entity';

/** A task's log: system events and comments. Read oldest first. */
@Entity('task_activity')
@Index('IDX_task_activity_task_at', ['workspaceId', 'taskId', 'at'])
@Check('CHK_task_activity_kind', `"kind" IN ('event', 'comment')`)
@Check('CHK_task_activity_tone', `"tone" IN ('normal', 'error')`)
export class TaskActivityRow {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Insertion order: breaks ties between rows written in the same millisecond. */
  @Column({ type: 'bigint', generatedIdentity: 'ALWAYS', insert: false, update: false })
  seq: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId: string;

  @ManyToOne(() => Workspace, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workspace_id' })
  workspace: Workspace;

  @Column({ name: 'task_id', type: 'varchar' })
  taskId: string;

  @ManyToOne(() => TaskEntity, { onDelete: 'CASCADE' })
  @JoinColumn([
    { name: 'workspace_id', referencedColumnName: 'workspaceId' },
    { name: 'task_id', referencedColumnName: 'id' },
  ])
  task: TaskEntity;

  /** Member or agent uuid; null for the system. */
  @Column({ type: 'varchar', nullable: true })
  by: string | null;

  @Column({ type: 'varchar', default: 'event' })
  kind: 'event' | 'comment';

  @Column({ type: 'text' })
  text: string;

  @Column({ type: 'varchar', default: 'normal' })
  tone: 'normal' | 'error';

  @Column({ type: 'timestamptz' })
  at: Date;
}
