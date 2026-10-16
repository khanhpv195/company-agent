import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitTodos1792134616923 implements MigrationInterface {
  name = 'InitTodos1792134616923';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            CREATE TYPE "public"."todo_priority" AS ENUM('low', 'medium', 'high')
        `);
    await queryRunner.query(`
            CREATE TABLE "todos" (
                "id" uuid NOT NULL DEFAULT gen_random_uuid(),
                "title" character varying(255) NOT NULL,
                "description" text,
                "completed" boolean NOT NULL DEFAULT false,
                "priority" "public"."todo_priority" NOT NULL DEFAULT 'medium',
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "PK_ca8cafd59ca6faaf67995344225" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_a624876e942ef326e906992387" ON "todos" ("completed")
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            DROP INDEX "public"."IDX_a624876e942ef326e906992387"
        `);
    await queryRunner.query(`
            DROP TABLE "todos"
        `);
    await queryRunner.query(`
            DROP TYPE "public"."todo_priority"
        `);
  }
}
