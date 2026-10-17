import type { AttentionItem } from '@repo/shared';
import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Computer } from '../../computers/entities/computer.entity';
import { Workspace } from '../../workspace/entities/workspace.entity';

/** "Needs attention" row of the dashboard: a failed run, an offline computer, ... */
@Entity('attention_items')
@Check('CHK_attention_items_kind', `"kind" IN ('error', 'warning', 'offline')`)
// The dashboard only lists open items, newest first.
@Index('IDX_attention_items_open_created', ['workspaceId', 'createdAt'], {
  where: `"resolved_at" IS NULL`,
})
// At most one open item per cause; resolving an item frees the key again.
@Index('UQ_attention_items_open_key', ['workspaceId', 'dedupKey'], {
  unique: true,
  where: `"resolved_at" IS NULL`,
})
export class AttentionItemRow {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId: string;

  @ManyToOne(() => Workspace, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workspace_id' })
  workspace: Workspace;

  @Column({ type: 'varchar' })
  kind: AttentionItem['kind'];

  @Column({ type: 'varchar' })
  title: string;

  @Column({ type: 'varchar' })
  meta: string;

  @Column({ type: 'varchar' })
  action: string;

  @Column({ name: 'task_id', type: 'varchar', nullable: true })
  taskId: string | null;

  @Column({ name: 'computer_id', type: 'uuid', nullable: true })
  computerId: string | null;

  @ManyToOne(() => Computer, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'computer_id' })
  computer: Computer | null;

  /** `<kind>:<taskId>:<computerId>`; the unique key of the open items. */
  @Column({ name: 'dedup_key', type: 'varchar' })
  dedupKey: string;

  @Column({ name: 'resolved_at', type: 'timestamptz', nullable: true })
  resolvedAt: Date | null;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}

/** The key two open items must not share. */
export const attentionKey = (
  kind: AttentionItem['kind'],
  taskId: string | null,
  computerId: string | null,
): string => `${kind}:${taskId ?? ''}:${computerId ?? ''}`;
