import { MigrationInterface, QueryRunner } from 'typeorm';

export class AccountSecurity1792245347378 implements MigrationInterface {
  name = 'AccountSecurity1792245347378';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            CREATE TABLE "account_tokens" (
                "id" uuid NOT NULL DEFAULT gen_random_uuid(),
                "member_id" uuid NOT NULL,
                "kind" character varying NOT NULL,
                "token_hash" character(64) NOT NULL,
                "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
                "used_at" TIMESTAMP WITH TIME ZONE,
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "UQ_account_tokens_token_hash" UNIQUE ("token_hash"),
                CONSTRAINT "CHK_account_tokens_kind" CHECK ("kind" IN ('reset_password', 'verify_email')),
                CONSTRAINT "PK_5e3640c493cc6206a44b885e6a9" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_8181f4cf1c6f35e6d0e358e0ed" ON "account_tokens" ("member_id")
        `);
    await queryRunner.query(`
            CREATE TABLE "audit_events" (
                "id" uuid NOT NULL DEFAULT gen_random_uuid(),
                "workspace_id" uuid NOT NULL,
                "actor_member_id" uuid,
                "action" character varying NOT NULL,
                "target_type" character varying,
                "target_id" character varying,
                "meta" jsonb NOT NULL DEFAULT '{}',
                "ip" character varying,
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "PK_910f64d901a5c3e9878f0d4a407" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_audit_events_workspace_created" ON "audit_events" ("workspace_id", "created_at")
        `);
    await queryRunner.query(`
            ALTER TABLE "members"
            ADD "email_verified_at" TIMESTAMP WITH TIME ZONE
        `);
    await queryRunner.query(`
            ALTER TABLE "members"
            ADD "failed_login_count" integer NOT NULL DEFAULT '0'
        `);
    await queryRunner.query(`
            ALTER TABLE "members"
            ADD "locked_until" TIMESTAMP WITH TIME ZONE
        `);
    await queryRunner.query(`
            ALTER TABLE "members"
            ADD "terms_accepted_at" TIMESTAMP WITH TIME ZONE
        `);
    await queryRunner.query(`
            ALTER TABLE "members"
            ADD "removed_at" TIMESTAMP WITH TIME ZONE
        `);
    await queryRunner.query(`
            ALTER TABLE "members"
            ADD "password_changed_at" TIMESTAMP WITH TIME ZONE
        `);
    // Members that exist before this migration are grandfathered in as verified and accepted.
    await queryRunner.query(`
            UPDATE "members"
            SET "email_verified_at" = "created_at",
                "terms_accepted_at" = "created_at",
                "password_changed_at" = "created_at"
        `);
    await queryRunner.query(`
            ALTER TABLE "refresh_tokens"
            ADD "user_agent" character varying(256)
        `);
    await queryRunner.query(`
            ALTER TABLE "refresh_tokens"
            ADD "ip" character varying(64)
        `);
    await queryRunner.query(`
            ALTER TABLE "account_tokens"
            ADD CONSTRAINT "FK_8181f4cf1c6f35e6d0e358e0ed8" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "audit_events"
            ADD CONSTRAINT "FK_ce538042f1afc3b80bfa0fb2de2" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "audit_events"
            ADD CONSTRAINT "FK_83f143dd433756d0d795f1b8f00" FOREIGN KEY ("actor_member_id") REFERENCES "members"("id") ON DELETE
            SET NULL ON UPDATE NO ACTION
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE "audit_events" DROP CONSTRAINT "FK_83f143dd433756d0d795f1b8f00"
        `);
    await queryRunner.query(`
            ALTER TABLE "audit_events" DROP CONSTRAINT "FK_ce538042f1afc3b80bfa0fb2de2"
        `);
    await queryRunner.query(`
            ALTER TABLE "account_tokens" DROP CONSTRAINT "FK_8181f4cf1c6f35e6d0e358e0ed8"
        `);
    await queryRunner.query(`
            ALTER TABLE "refresh_tokens" DROP COLUMN "ip"
        `);
    await queryRunner.query(`
            ALTER TABLE "refresh_tokens" DROP COLUMN "user_agent"
        `);
    await queryRunner.query(`
            ALTER TABLE "members" DROP COLUMN "password_changed_at"
        `);
    await queryRunner.query(`
            ALTER TABLE "members" DROP COLUMN "removed_at"
        `);
    await queryRunner.query(`
            ALTER TABLE "members" DROP COLUMN "terms_accepted_at"
        `);
    await queryRunner.query(`
            ALTER TABLE "members" DROP COLUMN "locked_until"
        `);
    await queryRunner.query(`
            ALTER TABLE "members" DROP COLUMN "failed_login_count"
        `);
    await queryRunner.query(`
            ALTER TABLE "members" DROP COLUMN "email_verified_at"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."IDX_audit_events_workspace_created"
        `);
    await queryRunner.query(`
            DROP TABLE "audit_events"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."IDX_8181f4cf1c6f35e6d0e358e0ed"
        `);
    await queryRunner.query(`
            DROP TABLE "account_tokens"
        `);
  }
}
