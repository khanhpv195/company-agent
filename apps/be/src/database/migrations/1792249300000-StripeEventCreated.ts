import { MigrationInterface, QueryRunner } from 'typeorm';

export class StripeEventCreated1792249300000 implements MigrationInterface {
  name = 'StripeEventCreated1792249300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE "workspaces"
            ADD "stripe_event_created" TIMESTAMP WITH TIME ZONE
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE "workspaces" DROP COLUMN "stripe_event_created"
        `);
  }
}
