import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Departments (a workspace's org units), plus `department_id` and `title` on members, agents and
 * invites. The case-insensitive name index is hand-written: TypeORM cannot declare expression
 * indexes. Deleting a department sets the references to null (the service does it too).
 */
export class Departments1792479313700 implements MigrationInterface {
  name = 'Departments1792479313700';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            CREATE TABLE "departments" (
                "id" uuid NOT NULL DEFAULT gen_random_uuid(),
                "workspace_id" uuid NOT NULL,
                "name" character varying(60) NOT NULL,
                "icon" character varying NOT NULL DEFAULT 'users',
                "rank" integer NOT NULL DEFAULT '0',
                "room_id" uuid,
                "template_id" character varying,
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "deleted_at" TIMESTAMP WITH TIME ZONE,
                CONSTRAINT "PK_839517a681a86bb84cbcc6a1e9d" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_2702bb18c2708aef9876a77329" ON "departments" ("workspace_id")
        `);
    await queryRunner.query(`
            CREATE UNIQUE INDEX "UQ_departments_workspace_name_ci"
            ON "departments" ("workspace_id", lower("name")) WHERE "deleted_at" IS NULL
        `);
    await queryRunner.query(`
            ALTER TABLE "agents"
            ADD "department_id" uuid
        `);
    await queryRunner.query(`
            ALTER TABLE "agents"
            ADD "title" character varying(80)
        `);
    await queryRunner.query(`
            ALTER TABLE "members"
            ADD "department_id" uuid
        `);
    await queryRunner.query(`
            ALTER TABLE "members"
            ADD "title" character varying(80)
        `);
    await queryRunner.query(`
            ALTER TABLE "invites"
            ADD "department_id" uuid
        `);
    await queryRunner.query(`
            ALTER TABLE "invites"
            ADD "title" character varying(80)
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_a32dd9e92510b1ef782236840f" ON "agents" ("department_id")
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_3eee8d9bac20dbabce411c52f4" ON "members" ("department_id")
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_2d90cb5f0c779ab72db868f9f0" ON "invites" ("department_id")
        `);
    await queryRunner.query(`
            ALTER TABLE "agents"
            ADD CONSTRAINT "FK_a32dd9e92510b1ef782236840f5" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE
            SET NULL ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "departments"
            ADD CONSTRAINT "FK_2702bb18c2708aef9876a773290" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "departments"
            ADD CONSTRAINT "FK_59fd891bdb60cf4561d01d85361" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE
            SET NULL ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "members"
            ADD CONSTRAINT "FK_3eee8d9bac20dbabce411c52f4f" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE
            SET NULL ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "invites"
            ADD CONSTRAINT "FK_2d90cb5f0c779ab72db868f9f04" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE
            SET NULL ON UPDATE NO ACTION
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE "invites" DROP CONSTRAINT "FK_2d90cb5f0c779ab72db868f9f04"
        `);
    await queryRunner.query(`
            ALTER TABLE "members" DROP CONSTRAINT "FK_3eee8d9bac20dbabce411c52f4f"
        `);
    await queryRunner.query(`
            ALTER TABLE "departments" DROP CONSTRAINT "FK_59fd891bdb60cf4561d01d85361"
        `);
    await queryRunner.query(`
            ALTER TABLE "departments" DROP CONSTRAINT "FK_2702bb18c2708aef9876a773290"
        `);
    await queryRunner.query(`
            ALTER TABLE "agents" DROP CONSTRAINT "FK_a32dd9e92510b1ef782236840f5"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."IDX_2d90cb5f0c779ab72db868f9f0"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."IDX_3eee8d9bac20dbabce411c52f4"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."IDX_a32dd9e92510b1ef782236840f"
        `);
    await queryRunner.query(`
            ALTER TABLE "invites" DROP COLUMN "title"
        `);
    await queryRunner.query(`
            ALTER TABLE "invites" DROP COLUMN "department_id"
        `);
    await queryRunner.query(`
            ALTER TABLE "members" DROP COLUMN "title"
        `);
    await queryRunner.query(`
            ALTER TABLE "members" DROP COLUMN "department_id"
        `);
    await queryRunner.query(`
            ALTER TABLE "agents" DROP COLUMN "title"
        `);
    await queryRunner.query(`
            ALTER TABLE "agents" DROP COLUMN "department_id"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."UQ_departments_workspace_name_ci"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."IDX_2702bb18c2708aef9876a77329"
        `);
    await queryRunner.query(`
            DROP TABLE "departments"
        `);
  }
}
