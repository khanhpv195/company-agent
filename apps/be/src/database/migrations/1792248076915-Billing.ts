import { MigrationInterface, QueryRunner } from 'typeorm';

export class Billing1792248076915 implements MigrationInterface {
  name = 'Billing1792248076915';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE "workspaces"
            ADD "stripe_customer_id" character varying
        `);
    await queryRunner.query(`
            ALTER TABLE "workspaces"
            ADD "stripe_subscription_id" character varying
        `);
    await queryRunner.query(`
            ALTER TABLE "workspaces"
            ADD "subscription_status" character varying
        `);
    await queryRunner.query(`
            ALTER TABLE "workspaces"
            ADD "current_period_end" TIMESTAMP WITH TIME ZONE
        `);
    await queryRunner.query(`
            ALTER TABLE "workspaces"
            ADD "cancel_at_period_end" boolean NOT NULL DEFAULT false
        `);
    await queryRunner.query(`
            ALTER TABLE "workspaces"
            ADD CONSTRAINT "CHK_workspaces_subscription_status" CHECK (
                    "subscription_status" IS NULL
                    OR "subscription_status" IN (
                        'active',
                        'trialing',
                        'past_due',
                        'canceled',
                        'incomplete'
                    )
                )
        `);
    await queryRunner.query(`
            CREATE TABLE "stripe_events" (
                "id" character varying NOT NULL,
                "type" character varying NOT NULL,
                "processed_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "PK_stripe_events_id" PRIMARY KEY ("id")
            )
        `);
    // Webhooks find the workspace by customer or subscription id.
    await queryRunner.query(`
            CREATE INDEX "IDX_workspaces_stripe_customer_id" ON "workspaces" ("stripe_customer_id")
            WHERE "stripe_customer_id" IS NOT NULL
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_workspaces_stripe_subscription_id" ON "workspaces" ("stripe_subscription_id")
            WHERE "stripe_subscription_id" IS NOT NULL
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_workspaces_stripe_subscription_id"`);
    await queryRunner.query(`DROP INDEX "IDX_workspaces_stripe_customer_id"`);
    await queryRunner.query(`DROP TABLE "stripe_events"`);
    await queryRunner.query(`
            ALTER TABLE "workspaces" DROP CONSTRAINT "CHK_workspaces_subscription_status"
        `);
    await queryRunner.query(`ALTER TABLE "workspaces" DROP COLUMN "cancel_at_period_end"`);
    await queryRunner.query(`ALTER TABLE "workspaces" DROP COLUMN "current_period_end"`);
    await queryRunner.query(`ALTER TABLE "workspaces" DROP COLUMN "subscription_status"`);
    await queryRunner.query(`ALTER TABLE "workspaces" DROP COLUMN "stripe_subscription_id"`);
    await queryRunner.query(`ALTER TABLE "workspaces" DROP COLUMN "stripe_customer_id"`);
  }
}
