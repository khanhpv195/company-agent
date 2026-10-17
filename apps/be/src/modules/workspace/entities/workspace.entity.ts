import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import type { SubscriptionStatus, WorkspacePlan } from '@repo/shared';
import { Member } from './member.entity';

@Entity('workspaces')
@Unique('UQ_workspaces_slug', ['slug'])
@Check('CHK_workspaces_plan', `"plan" IN ('free', 'pro', 'team')`)
@Check(
  'CHK_workspaces_subscription_status',
  `"subscription_status" IS NULL OR "subscription_status" IN ('active', 'trialing', 'past_due', 'canceled', 'incomplete')`,
)
export class Workspace {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar' })
  name: string;

  @Column({ type: 'varchar' })
  slug: string;

  @Column({ type: 'varchar', default: 'free' })
  plan: WorkspacePlan;

  /** Never sent to clients. */
  @Index('IDX_workspaces_stripe_customer_id', { where: '"stripe_customer_id" IS NOT NULL' })
  @Column({ name: 'stripe_customer_id', type: 'varchar', nullable: true })
  stripeCustomerId: string | null;

  @Index('IDX_workspaces_stripe_subscription_id', {
    where: '"stripe_subscription_id" IS NOT NULL',
  })
  @Column({ name: 'stripe_subscription_id', type: 'varchar', nullable: true })
  stripeSubscriptionId: string | null;

  @Column({ name: 'subscription_status', type: 'varchar', nullable: true })
  subscriptionStatus: SubscriptionStatus | null;

  @Column({ name: 'current_period_end', type: 'timestamptz', nullable: true })
  currentPeriodEnd: Date | null;

  @Column({ name: 'cancel_at_period_end', type: 'boolean', default: false })
  cancelAtPeriodEnd: boolean;

  /** `created` of the newest Stripe event applied: older events are late deliveries. */
  @Column({ name: 'stripe_event_created', type: 'timestamptz', nullable: true })
  stripeEventCreated: Date | null;

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
