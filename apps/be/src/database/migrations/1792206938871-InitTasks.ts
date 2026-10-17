import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitTasks1792206938871 implements MigrationInterface {
  name = 'InitTasks1792206938871';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // An offered task run already occupies its agent: widen the one-task-run index.
    await queryRunner.query(`
            DROP INDEX "public"."UQ_assignments_one_task_run_per_agent"
        `);
    await queryRunner.query(`
            CREATE UNIQUE INDEX "UQ_assignments_one_task_run_per_agent" ON "assignments" ("agent_id")
            WHERE "source_kind" = 'task'
                AND "status" IN ('offered', 'claimed', 'running')
        `);
    await queryRunner.query(`
            CREATE TABLE "tasks" (
                "workspace_id" uuid NOT NULL,
                "id" character varying NOT NULL,
                "title" character varying NOT NULL,
                "description" text NOT NULL DEFAULT '',
                "status" character varying NOT NULL DEFAULT 'todo',
                "assignee_agent_id" uuid,
                "assignee_member_id" uuid,
                "priority" character varying NOT NULL DEFAULT 'med',
                "labels" text array NOT NULL DEFAULT '{}',
                "chat_id" character varying,
                "requires_review" boolean NOT NULL DEFAULT true,
                "subtasks" jsonb NOT NULL DEFAULT '[]',
                "output" text,
                "blocked_reason" text,
                "error" text,
                "rank" double precision NOT NULL DEFAULT '0',
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "CHK_tasks_single_assignee" CHECK (
                    "assignee_agent_id" IS NULL
                    OR "assignee_member_id" IS NULL
                ),
                CONSTRAINT "CHK_tasks_priority" CHECK ("priority" IN ('urgent', 'high', 'med', 'low')),
                CONSTRAINT "CHK_tasks_status" CHECK (
                    "status" IN ('backlog', 'todo', 'doing', 'review', 'done')
                ),
                CONSTRAINT "PK_5a365a683c5bc96782a8a9aa7d9" PRIMARY KEY ("workspace_id", "id")
            )
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_tasks_workspace_status_rank" ON "tasks" ("workspace_id", "status", "rank")
        `);
    await queryRunner.query(`
            CREATE TABLE "task_activity" (
                "id" uuid NOT NULL DEFAULT gen_random_uuid(),
                "seq" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
                "workspace_id" uuid NOT NULL,
                "task_id" character varying NOT NULL,
                "by" character varying,
                "kind" character varying NOT NULL DEFAULT 'event',
                "text" text NOT NULL,
                "tone" character varying NOT NULL DEFAULT 'normal',
                "at" TIMESTAMP WITH TIME ZONE NOT NULL,
                CONSTRAINT "CHK_task_activity_tone" CHECK ("tone" IN ('normal', 'error')),
                CONSTRAINT "CHK_task_activity_kind" CHECK ("kind" IN ('event', 'comment')),
                CONSTRAINT "PK_a8f24c7952c9ff5533f88279941" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_task_activity_task_at" ON "task_activity" ("workspace_id", "task_id", "at")
        `);
    await queryRunner.query(`
            CREATE TABLE "task_runs" (
                "id" uuid NOT NULL DEFAULT gen_random_uuid(),
                "workspace_id" uuid NOT NULL,
                "task_id" character varying NOT NULL,
                "assignment_id" uuid NOT NULL,
                "n" integer NOT NULL,
                "step" integer NOT NULL DEFAULT '0',
                "steps" jsonb NOT NULL DEFAULT '[]',
                "status" character varying,
                "duration_sec" integer,
                "tool_calls" integer,
                "error" text,
                "finalized_at" TIMESTAMP WITH TIME ZONE,
                CONSTRAINT "UQ_task_runs_task_n" UNIQUE ("workspace_id", "task_id", "n"),
                CONSTRAINT "UQ_task_runs_assignment" UNIQUE ("assignment_id"),
                CONSTRAINT "PK_52c37d0e12c4de37ae7bbff7850" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_task_runs_workspace_finalized" ON "task_runs" ("workspace_id", "finalized_at")
        `);
    await queryRunner.query(`
            ALTER TABLE "tasks"
            ADD CONSTRAINT "FK_5cb6ca4667dfa947871694da959" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "tasks"
            ADD CONSTRAINT "FK_1f1181f8504b79f106bc05e6726" FOREIGN KEY ("assignee_agent_id") REFERENCES "agents"("id") ON DELETE
            SET NULL ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "tasks"
            ADD CONSTRAINT "FK_6986464882b1c808a059425f37d" FOREIGN KEY ("assignee_member_id") REFERENCES "members"("id") ON DELETE
            SET NULL ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "task_activity"
            ADD CONSTRAINT "FK_6dcb37045eb1158e6eb966ce998" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "task_activity"
            ADD CONSTRAINT "FK_641ea768040f0d9c1deb7069f69" FOREIGN KEY ("workspace_id", "task_id") REFERENCES "tasks"("workspace_id", "id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "task_runs"
            ADD CONSTRAINT "FK_5a199323020d628dbc5b74b86f1" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "task_runs"
            ADD CONSTRAINT "FK_09e15912484f2a18f96371d6f53" FOREIGN KEY ("workspace_id", "task_id") REFERENCES "tasks"("workspace_id", "id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "task_runs"
            ADD CONSTRAINT "FK_00078fde5f1cc6f4d74ea2505cf" FOREIGN KEY ("assignment_id") REFERENCES "assignments"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE "task_runs" DROP CONSTRAINT "FK_00078fde5f1cc6f4d74ea2505cf"
        `);
    await queryRunner.query(`
            ALTER TABLE "task_runs" DROP CONSTRAINT "FK_09e15912484f2a18f96371d6f53"
        `);
    await queryRunner.query(`
            ALTER TABLE "task_runs" DROP CONSTRAINT "FK_5a199323020d628dbc5b74b86f1"
        `);
    await queryRunner.query(`
            ALTER TABLE "task_activity" DROP CONSTRAINT "FK_641ea768040f0d9c1deb7069f69"
        `);
    await queryRunner.query(`
            ALTER TABLE "task_activity" DROP CONSTRAINT "FK_6dcb37045eb1158e6eb966ce998"
        `);
    await queryRunner.query(`
            ALTER TABLE "tasks" DROP CONSTRAINT "FK_6986464882b1c808a059425f37d"
        `);
    await queryRunner.query(`
            ALTER TABLE "tasks" DROP CONSTRAINT "FK_1f1181f8504b79f106bc05e6726"
        `);
    await queryRunner.query(`
            ALTER TABLE "tasks" DROP CONSTRAINT "FK_5cb6ca4667dfa947871694da959"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."IDX_task_runs_workspace_finalized"
        `);
    await queryRunner.query(`
            DROP TABLE "task_runs"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."IDX_task_activity_task_at"
        `);
    await queryRunner.query(`
            DROP TABLE "task_activity"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."IDX_tasks_workspace_status_rank"
        `);
    await queryRunner.query(`
            DROP TABLE "tasks"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."UQ_assignments_one_task_run_per_agent"
        `);
    await queryRunner.query(`
            CREATE UNIQUE INDEX "UQ_assignments_one_task_run_per_agent" ON "assignments" ("agent_id")
            WHERE "source_kind" = 'task'
                AND "status" IN ('claimed', 'running')
        `);
  }
}
