import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The workspace skill library (`skills`, `skill_versions`) and the move of `agents.skills` from
 * the old fixed catalog (`[{ id, name, enabled }]`) to a jsonb array of enabled skill uuids.
 * The data part is plain SQL on purpose: it must not depend on app or shared code, which change
 * after this migration ran.
 */

export class Skills1792482628559 implements MigrationInterface {
  name = 'Skills1792482628559';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            CREATE TABLE "skills" (
                "id" uuid NOT NULL DEFAULT gen_random_uuid(),
                "workspace_id" uuid NOT NULL,
                "slug" character varying(64) NOT NULL,
                "name" character varying(80) NOT NULL,
                "description" character varying(500) NOT NULL,
                "content" text NOT NULL,
                "template_id" character varying,
                "version" integer NOT NULL DEFAULT '1',
                "created_by_member_id" uuid,
                "updated_by_member_id" uuid,
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "deleted_at" TIMESTAMP WITH TIME ZONE,
                CONSTRAINT "PK_0d3212120f4ecedf90864d7e298" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_36dc87c93505f0a479f7f47e9a" ON "skills" ("workspace_id")
        `);
    await queryRunner.query(`
            CREATE UNIQUE INDEX "UQ_skills_workspace_slug_live" ON "skills" ("workspace_id", "slug")
            WHERE "deleted_at" IS NULL
        `);
    await queryRunner.query(`
            CREATE TABLE "skill_versions" (
                "id" uuid NOT NULL DEFAULT gen_random_uuid(),
                "skill_id" uuid NOT NULL,
                "version" integer NOT NULL,
                "name" character varying(80) NOT NULL,
                "description" character varying(500) NOT NULL,
                "content" text NOT NULL,
                "edited_by_member_id" uuid,
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "UQ_skill_versions_skill_version" UNIQUE ("skill_id", "version"),
                CONSTRAINT "PK_5c98dbb0de0ba8fbe6c7e0a768c" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            ALTER TABLE "skills"
            ADD CONSTRAINT "FK_36dc87c93505f0a479f7f47e9a5" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "skills"
            ADD CONSTRAINT "FK_22eeb9ca438d0aa9d76384bde21" FOREIGN KEY ("created_by_member_id") REFERENCES "members"("id") ON DELETE
            SET NULL ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "skills"
            ADD CONSTRAINT "FK_67e8fbdce8f16b837825fb6618b" FOREIGN KEY ("updated_by_member_id") REFERENCES "members"("id") ON DELETE
            SET NULL ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "skill_versions"
            ADD CONSTRAINT "FK_1ef1caf0168b78a96ece715646d" FOREIGN KEY ("skill_id") REFERENCES "skills"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "skill_versions"
            ADD CONSTRAINT "FK_3405f3df12d4798ca1f4d8d65ef" FOREIGN KEY ("edited_by_member_id") REFERENCES "members"("id") ON DELETE
            SET NULL ON UPDATE NO ACTION
        `);
    // Data: every legacy skill id enabled on a live agent becomes a library skill of its
    // workspace (slug = name = the legacy id, placeholder content, version 1).
    await queryRunner.query(`
            INSERT INTO "skills" ("workspace_id", "slug", "name", "description", "content", "version")
            SELECT DISTINCT a."workspace_id", e.value ->> 'id', e.value ->> 'id',
              'Legacy skill "' || (e.value ->> 'id') || '"',
              'This skill was migrated from the old fixed skill list and has no instructions yet. Edit it to describe what the agent should do.',
              1
            FROM "agents" a
            CROSS JOIN LATERAL jsonb_array_elements(
              CASE WHEN jsonb_typeof(a."skills") = 'array' THEN a."skills" ELSE '[]'::jsonb END
            ) AS e(value)
            WHERE a."deleted_at" IS NULL
              AND jsonb_typeof(e.value) = 'object'
              AND coalesce(e.value ->> 'enabled', 'false') = 'true'
              AND (e.value ->> 'id') ~ '^[a-z0-9-]{1,64}$'
        `);
    await queryRunner.query(`
            INSERT INTO "skill_versions" ("skill_id", "version", "name", "description", "content")
            SELECT "id", 1, "name", "description", "content" FROM "skills"
        `);
    // agents.skills becomes the array of enabled skill uuids (ids with no skill are dropped).
    await queryRunner.query(`
            UPDATE "agents" a SET "skills" = coalesce((
              SELECT jsonb_agg(to_jsonb(s."id"::text) ORDER BY s."slug")
              FROM jsonb_array_elements(
                CASE WHEN jsonb_typeof(a."skills") = 'array' THEN a."skills" ELSE '[]'::jsonb END
              ) AS e(value)
              JOIN "skills" s
                ON s."workspace_id" = a."workspace_id" AND s."slug" = (e.value ->> 'id')
              WHERE jsonb_typeof(e.value) = 'object'
                AND coalesce(e.value ->> 'enabled', 'false') = 'true'
            ), '[]'::jsonb)
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // agents.skills back to the old shape: the enabled skills only, id = name = slug.
    await queryRunner.query(`
            UPDATE "agents" a SET "skills" = coalesce((
              SELECT jsonb_agg(
                jsonb_build_object('id', s."slug", 'name', s."slug", 'enabled', true)
                ORDER BY s."slug"
              )
              FROM jsonb_array_elements_text(
                CASE WHEN jsonb_typeof(a."skills") = 'array' THEN a."skills" ELSE '[]'::jsonb END
              ) AS e(value)
              JOIN "skills" s ON s."id"::text = e.value AND s."workspace_id" = a."workspace_id"
            ), '[]'::jsonb)
        `);
    await queryRunner.query(`
            ALTER TABLE "skill_versions" DROP CONSTRAINT "FK_3405f3df12d4798ca1f4d8d65ef"
        `);
    await queryRunner.query(`
            ALTER TABLE "skill_versions" DROP CONSTRAINT "FK_1ef1caf0168b78a96ece715646d"
        `);
    await queryRunner.query(`
            ALTER TABLE "skills" DROP CONSTRAINT "FK_67e8fbdce8f16b837825fb6618b"
        `);
    await queryRunner.query(`
            ALTER TABLE "skills" DROP CONSTRAINT "FK_22eeb9ca438d0aa9d76384bde21"
        `);
    await queryRunner.query(`
            ALTER TABLE "skills" DROP CONSTRAINT "FK_36dc87c93505f0a479f7f47e9a5"
        `);
    await queryRunner.query(`
            DROP TABLE "skill_versions"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."UQ_skills_workspace_slug_live"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."IDX_36dc87c93505f0a479f7f47e9a"
        `);
    await queryRunner.query(`
            DROP TABLE "skills"
        `);
  }
}
