import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitDashboard1792208100000 implements MigrationInterface {
  name = 'InitDashboard1792208100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            CREATE TABLE "attention_items" (
                "id" uuid NOT NULL DEFAULT gen_random_uuid(),
                "workspace_id" uuid NOT NULL,
                "kind" character varying NOT NULL,
                "title" character varying NOT NULL,
                "meta" character varying NOT NULL,
                "action" character varying NOT NULL,
                "task_id" character varying,
                "computer_id" uuid,
                "dedup_key" character varying NOT NULL,
                "resolved_at" TIMESTAMP WITH TIME ZONE,
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL,
                CONSTRAINT "CHK_attention_items_kind" CHECK ("kind" IN ('error', 'warning', 'offline')),
                CONSTRAINT "PK_a28e95c97b2c2ede567437329cf" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE UNIQUE INDEX "UQ_attention_items_open_key" ON "attention_items" ("workspace_id", "dedup_key")
            WHERE "resolved_at" IS NULL
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_attention_items_open_created" ON "attention_items" ("workspace_id", "created_at")
            WHERE "resolved_at" IS NULL
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_assignments_workspace_ended" ON "assignments" ("workspace_id", "ended_at")
        `);
    await queryRunner.query(`
            CREATE TABLE "feed_items" (
                "id" uuid NOT NULL DEFAULT gen_random_uuid(),
                "workspace_id" uuid NOT NULL,
                "by" character varying NOT NULL,
                "text" text NOT NULL,
                "at" TIMESTAMP WITH TIME ZONE NOT NULL,
                CONSTRAINT "PK_9a33f003d604fbe4060d75c7be2" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_feed_items_workspace_at" ON "feed_items" ("workspace_id", "at")
        `);
    await queryRunner.query(`
            ALTER TABLE "attention_items"
            ADD CONSTRAINT "FK_838d9eff0fa9766e064af608428" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "attention_items"
            ADD CONSTRAINT "FK_7419989251e71428b4b913bcadf" FOREIGN KEY ("computer_id") REFERENCES "computers"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "feed_items"
            ADD CONSTRAINT "FK_c35ba45d791a669f1ef76e24930" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE "feed_items" DROP CONSTRAINT "FK_c35ba45d791a669f1ef76e24930"
        `);
    await queryRunner.query(`
            ALTER TABLE "attention_items" DROP CONSTRAINT "FK_7419989251e71428b4b913bcadf"
        `);
    await queryRunner.query(`
            ALTER TABLE "attention_items" DROP CONSTRAINT "FK_838d9eff0fa9766e064af608428"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."IDX_feed_items_workspace_at"
        `);
    await queryRunner.query(`
            DROP TABLE "feed_items"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."IDX_assignments_workspace_ended"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."IDX_attention_items_open_created"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."UQ_attention_items_open_key"
        `);
    await queryRunner.query(`
            DROP TABLE "attention_items"
        `);
  }
}
