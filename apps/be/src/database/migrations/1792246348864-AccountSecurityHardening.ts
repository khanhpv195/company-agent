import { MigrationInterface, QueryRunner } from 'typeorm';

export class AccountSecurityHardening1792246348864 implements MigrationInterface {
  name = 'AccountSecurityHardening1792246348864';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            DROP INDEX "public"."IDX_8181f4cf1c6f35e6d0e358e0ed"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."IDX_audit_events_workspace_created"
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_account_tokens_member_kind" ON "account_tokens" ("member_id", "kind")
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_audit_events_workspace_created_id" ON "audit_events" ("workspace_id", "created_at", "id")
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            DROP INDEX "public"."IDX_audit_events_workspace_created_id"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."IDX_account_tokens_member_kind"
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_audit_events_workspace_created" ON "audit_events" USING btree ("workspace_id", "created_at")
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_8181f4cf1c6f35e6d0e358e0ed" ON "account_tokens" USING btree ("member_id")
        `);
  }
}
