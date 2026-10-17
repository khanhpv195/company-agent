import { MigrationInterface, QueryRunner } from 'typeorm';

export class TeamInvites1792247017120 implements MigrationInterface {
  name = 'TeamInvites1792247017120';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            CREATE TABLE "invites" (
                "id" uuid NOT NULL DEFAULT gen_random_uuid(),
                "workspace_id" uuid NOT NULL,
                "email" character varying NOT NULL,
                "role" character varying NOT NULL,
                "token_hash" character varying NOT NULL,
                "invited_by" uuid,
                "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
                "accepted_at" TIMESTAMP WITH TIME ZONE,
                "revoked_at" TIMESTAMP WITH TIME ZONE,
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "UQ_invites_token_hash" UNIQUE ("token_hash"),
                CONSTRAINT "CHK_invites_role" CHECK ("role" IN ('admin', 'member')),
                CONSTRAINT "PK_aa52e96b44a714372f4dd31a0af" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_568872c5b015a0e9d763837d53" ON "invites" ("workspace_id")
        `);
    await queryRunner.query(`
            CREATE UNIQUE INDEX "UQ_invites_pending_email" ON "invites" ("workspace_id", "email")
            WHERE "accepted_at" IS NULL
                AND "revoked_at" IS NULL
        `);
    await queryRunner.query(`
            ALTER TABLE "invites"
            ADD CONSTRAINT "FK_568872c5b015a0e9d763837d530" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "invites"
            ADD CONSTRAINT "FK_6e727f063d839c0090364ea95f3" FOREIGN KEY ("invited_by") REFERENCES "members"("id") ON DELETE
            SET NULL ON UPDATE NO ACTION
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE "invites" DROP CONSTRAINT "FK_6e727f063d839c0090364ea95f3"
        `);
    await queryRunner.query(`
            ALTER TABLE "invites" DROP CONSTRAINT "FK_568872c5b015a0e9d763837d530"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."UQ_invites_pending_email"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."IDX_568872c5b015a0e9d763837d53"
        `);
    await queryRunner.query(`
            DROP TABLE "invites"
        `);
  }
}
