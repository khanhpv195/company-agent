import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitAuth1792171677374 implements MigrationInterface {
  name = 'InitAuth1792171677374';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            CREATE TABLE "workspaces" (
                "id" uuid NOT NULL DEFAULT gen_random_uuid(),
                "name" character varying NOT NULL,
                "slug" character varying NOT NULL,
                "plan" character varying NOT NULL DEFAULT 'free',
                "task_seq" integer NOT NULL DEFAULT '0',
                "scheduler_paused" boolean NOT NULL DEFAULT false,
                "onboarded_at" TIMESTAMP WITH TIME ZONE,
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "UQ_workspaces_slug" UNIQUE ("slug"),
                CONSTRAINT "CHK_workspaces_plan" CHECK ("plan" IN ('free', 'pro', 'team')),
                CONSTRAINT "PK_098656ae401f3e1a4586f47fd8e" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE TABLE "members" (
                "id" uuid NOT NULL DEFAULT gen_random_uuid(),
                "workspace_id" uuid NOT NULL,
                "name" character varying NOT NULL,
                "email" character varying NOT NULL,
                "password_hash" character varying NOT NULL,
                "role" character varying NOT NULL,
                "color" character varying,
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "UQ_members_email" UNIQUE ("email"),
                CONSTRAINT "CHK_members_role" CHECK ("role" IN ('owner', 'admin', 'member')),
                CONSTRAINT "CHK_members_email_lowercase" CHECK ("email" = lower(btrim("email"))),
                CONSTRAINT "PK_28b53062261b996d9c99fa12404" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_c3c299323f3c28b40c2f6479a3" ON "members" ("workspace_id")
        `);
    await queryRunner.query(`
            CREATE TABLE "refresh_tokens" (
                "id" uuid NOT NULL DEFAULT gen_random_uuid(),
                "member_id" uuid NOT NULL,
                "family_id" uuid NOT NULL,
                "token_hash" character(64) NOT NULL,
                "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
                "revoked_at" TIMESTAMP WITH TIME ZONE,
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "UQ_refresh_tokens_token_hash" UNIQUE ("token_hash"),
                CONSTRAINT "PK_7d8bee0204106019488c4c50ffa" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_153c1749d234e70f09786d11c6" ON "refresh_tokens" ("member_id")
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_d5e27da0cd39bc3bb2811fc8ba" ON "refresh_tokens" ("family_id")
        `);
    await queryRunner.query(`
            ALTER TABLE "members"
            ADD CONSTRAINT "FK_c3c299323f3c28b40c2f6479a38" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "refresh_tokens"
            ADD CONSTRAINT "FK_153c1749d234e70f09786d11c60" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE "refresh_tokens" DROP CONSTRAINT "FK_153c1749d234e70f09786d11c60"
        `);
    await queryRunner.query(`
            ALTER TABLE "members" DROP CONSTRAINT "FK_c3c299323f3c28b40c2f6479a38"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."IDX_d5e27da0cd39bc3bb2811fc8ba"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."IDX_153c1749d234e70f09786d11c6"
        `);
    await queryRunner.query(`
            DROP TABLE "refresh_tokens"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."IDX_c3c299323f3c28b40c2f6479a3"
        `);
    await queryRunner.query(`
            DROP TABLE "members"
        `);
    await queryRunner.query(`
            DROP TABLE "workspaces"
        `);
  }
}
