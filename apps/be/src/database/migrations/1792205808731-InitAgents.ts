import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitAgents1792205808731 implements MigrationInterface {
  name = 'InitAgents1792205808731';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            CREATE TABLE "computers" (
                "id" uuid NOT NULL DEFAULT gen_random_uuid(),
                "workspace_id" uuid NOT NULL,
                "name" character varying NOT NULL,
                "os" character varying NOT NULL,
                "status" character varying NOT NULL DEFAULT 'offline',
                "last_heartbeat_at" TIMESTAMP WITH TIME ZONE NOT NULL,
                "keep_awake" boolean NOT NULL DEFAULT false,
                "cli_version" character varying NOT NULL,
                "api_key_hash" character(64),
                "simulated" boolean NOT NULL DEFAULT false,
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "UQ_computers_api_key_hash" UNIQUE ("api_key_hash"),
                CONSTRAINT "PK_d755c706431be017ddf9fd5025a" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_16a8b7e45e75b71f0a11f20f05" ON "computers" ("workspace_id")
        `);
    await queryRunner.query(`
            CREATE TABLE "agents" (
                "id" uuid NOT NULL DEFAULT gen_random_uuid(),
                "workspace_id" uuid NOT NULL,
                "computer_id" uuid NOT NULL,
                "name" character varying NOT NULL,
                "avatar" integer NOT NULL DEFAULT '0',
                "provider" character varying NOT NULL DEFAULT 'claude-code',
                "persona" text NOT NULL DEFAULT '',
                "workdir" character varying NOT NULL,
                "max_turns" integer NOT NULL DEFAULT '40',
                "skills" jsonb NOT NULL DEFAULT '[]',
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "PK_9c653f28ae19c5884d5baf6a1d9" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_e4073e164112770e13f73919ba" ON "agents" ("workspace_id")
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_b47e42ce74be6b3d6413da92aa" ON "agents" ("computer_id")
        `);
    await queryRunner.query(`
            CREATE TABLE "agent_activity" (
                "id" uuid NOT NULL DEFAULT gen_random_uuid(),
                "workspace_id" uuid NOT NULL,
                "agent_id" uuid NOT NULL,
                "location" character varying NOT NULL,
                "request" text NOT NULL,
                "status" character varying NOT NULL,
                "at" TIMESTAMP WITH TIME ZONE NOT NULL,
                CONSTRAINT "PK_34622b8797ee22e1078159d2b91" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_5a01912213dc74e0e19b93f2d9" ON "agent_activity" ("workspace_id")
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_agent_activity_agent_at" ON "agent_activity" ("agent_id", "at")
        `);
    await queryRunner.query(`
            CREATE TABLE "assignments" (
                "id" uuid NOT NULL DEFAULT gen_random_uuid(),
                "workspace_id" uuid NOT NULL,
                "agent_id" uuid NOT NULL,
                "computer_id" uuid NOT NULL,
                "source_kind" character varying NOT NULL,
                "source_id" character varying NOT NULL,
                "status" character varying NOT NULL DEFAULT 'pending',
                "attempt" integer NOT NULL DEFAULT '0',
                "activation" character varying,
                "session_key" character varying,
                "lease_expires_at" TIMESTAMP WITH TIME ZONE,
                "tool_calls" integer NOT NULL DEFAULT '0',
                "error" text,
                "started_at" TIMESTAMP WITH TIME ZONE,
                "ended_at" TIMESTAMP WITH TIME ZONE,
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "PK_c54ca359535e0012b04dcbd80ee" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE UNIQUE INDEX "UQ_assignments_one_task_run_per_agent" ON "assignments" ("agent_id")
            WHERE "source_kind" = 'task'
                AND "status" IN ('claimed', 'running')
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_assignments_source" ON "assignments" ("source_kind", "source_id")
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_assignments_agent_status" ON "assignments" ("agent_id", "status")
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_assignments_workspace_status" ON "assignments" ("workspace_id", "status")
        `);
    await queryRunner.query(`
            ALTER TABLE "computers"
            ADD CONSTRAINT "FK_16a8b7e45e75b71f0a11f20f056" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "agents"
            ADD CONSTRAINT "FK_e4073e164112770e13f73919bac" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "agents"
            ADD CONSTRAINT "FK_b47e42ce74be6b3d6413da92aa5" FOREIGN KEY ("computer_id") REFERENCES "computers"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "agent_activity"
            ADD CONSTRAINT "FK_5a01912213dc74e0e19b93f2d94" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "agent_activity"
            ADD CONSTRAINT "FK_46d9b81f9456c58708707bec2a7" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "assignments"
            ADD CONSTRAINT "FK_8ab17ce9ce965517f7200d83c98" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "assignments"
            ADD CONSTRAINT "FK_e8cfe697be8ff0498712d203c14" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "assignments"
            ADD CONSTRAINT "FK_f6d075f4c10bb503e0800df5735" FOREIGN KEY ("computer_id") REFERENCES "computers"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE "assignments" DROP CONSTRAINT "FK_f6d075f4c10bb503e0800df5735"
        `);
    await queryRunner.query(`
            ALTER TABLE "assignments" DROP CONSTRAINT "FK_e8cfe697be8ff0498712d203c14"
        `);
    await queryRunner.query(`
            ALTER TABLE "assignments" DROP CONSTRAINT "FK_8ab17ce9ce965517f7200d83c98"
        `);
    await queryRunner.query(`
            ALTER TABLE "agent_activity" DROP CONSTRAINT "FK_46d9b81f9456c58708707bec2a7"
        `);
    await queryRunner.query(`
            ALTER TABLE "agent_activity" DROP CONSTRAINT "FK_5a01912213dc74e0e19b93f2d94"
        `);
    await queryRunner.query(`
            ALTER TABLE "agents" DROP CONSTRAINT "FK_b47e42ce74be6b3d6413da92aa5"
        `);
    await queryRunner.query(`
            ALTER TABLE "agents" DROP CONSTRAINT "FK_e4073e164112770e13f73919bac"
        `);
    await queryRunner.query(`
            ALTER TABLE "computers" DROP CONSTRAINT "FK_16a8b7e45e75b71f0a11f20f056"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."IDX_assignments_workspace_status"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."IDX_assignments_agent_status"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."IDX_assignments_source"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."UQ_assignments_one_task_run_per_agent"
        `);
    await queryRunner.query(`
            DROP TABLE "assignments"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."IDX_agent_activity_agent_at"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."IDX_5a01912213dc74e0e19b93f2d9"
        `);
    await queryRunner.query(`
            DROP TABLE "agent_activity"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."IDX_b47e42ce74be6b3d6413da92aa"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."IDX_e4073e164112770e13f73919ba"
        `);
    await queryRunner.query(`
            DROP TABLE "agents"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."IDX_16a8b7e45e75b71f0a11f20f05"
        `);
    await queryRunner.query(`
            DROP TABLE "computers"
        `);
  }
}
