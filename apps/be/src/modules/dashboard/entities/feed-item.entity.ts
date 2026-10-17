import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Workspace } from '../../workspace/entities/workspace.entity';

/** One line of the dashboard activity feed ("<who> <text>"). */
@Entity('feed_items')
@Index('IDX_feed_items_workspace_at', ['workspaceId', 'at'])
export class FeedItemRow {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId: string;

  @ManyToOne(() => Workspace, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workspace_id' })
  workspace: Workspace;

  /** Member or agent id (kept loose: the actor may be removed later). */
  @Column({ type: 'varchar' })
  by: string;

  /** Inline markdown. */
  @Column({ type: 'text' })
  text: string;

  @Column({ type: 'timestamptz' })
  at: Date;
}
