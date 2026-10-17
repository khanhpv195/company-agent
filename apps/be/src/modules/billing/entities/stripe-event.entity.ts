import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

/** Webhook events already applied: the id is the idempotency key (Stripe retries deliveries). */
@Entity('stripe_events')
export class StripeEvent {
  @PrimaryColumn({ type: 'varchar', primaryKeyConstraintName: 'PK_stripe_events_id' })
  id: string;

  @Column({ type: 'varchar' })
  type: string;

  @CreateDateColumn({ name: 'processed_at', type: 'timestamptz' })
  processedAt: Date;
}
