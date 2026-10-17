import { MigrationInterface, QueryRunner } from 'typeorm';

export class AgentsSoftDelete1792214700000 implements MigrationInterface {
  name = 'AgentsSoftDelete1792214700000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE "agents"
            ADD "deleted_at" TIMESTAMP WITH TIME ZONE
        `);
    // Live agents that already share a name get ` (2)`, ` (3)`... on the later ones.
    await queryRunner.query(`
            UPDATE "agents" a
            SET "name" = a."name" || ' (' || d.rn || ')'
            FROM (
                SELECT "id", ROW_NUMBER() OVER (
                    PARTITION BY "workspace_id", "name" ORDER BY "created_at", "id"
                ) AS rn
                FROM "agents"
            ) d
            WHERE a."id" = d."id" AND d.rn > 1
        `);
    await queryRunner.query(`
            CREATE UNIQUE INDEX "UQ_agents_workspace_name_live" ON "agents" ("workspace_id", "name")
            WHERE "deleted_at" IS NULL
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            DROP INDEX "public"."UQ_agents_workspace_name_live"
        `);
    await queryRunner.query(`
            ALTER TABLE "agents" DROP COLUMN "deleted_at"
        `);
  }
}
