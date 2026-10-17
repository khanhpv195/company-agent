import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitChat1792207893864 implements MigrationInterface {
  name = 'InitChat1792207893864';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            CREATE TABLE "messages" (
                "id" uuid NOT NULL DEFAULT gen_random_uuid(),
                "workspace_id" uuid NOT NULL,
                "chat_id" uuid NOT NULL,
                "seq" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
                "chat_kind" character varying NOT NULL,
                "author_kind" character varying NOT NULL,
                "author_member_id" uuid,
                "author_agent_id" uuid,
                "external_connection_id" character varying,
                "external_name" character varying,
                "status" character varying NOT NULL DEFAULT 'complete',
                "markdown" text NOT NULL DEFAULT '',
                "assignment_id" uuid,
                "draft" jsonb,
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL,
                CONSTRAINT "CHK_messages_status" CHECK ("status" IN ('streaming', 'complete', 'failed')),
                CONSTRAINT "CHK_messages_author_kind" CHECK ("author_kind" IN ('human', 'agent', 'external')),
                CONSTRAINT "CHK_messages_chat_kind" CHECK ("chat_kind" IN ('dm', 'thread')),
                CONSTRAINT "PK_18325f38ae6de43878487eff986" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_fb06c053a271467000dbd1d1da" ON "messages" ("workspace_id")
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_messages_assignment" ON "messages" ("assignment_id")
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_messages_chat_created" ON "messages" ("chat_id", "created_at")
        `);
    await queryRunner.query(`
            CREATE TABLE "rooms" (
                "id" uuid NOT NULL DEFAULT gen_random_uuid(),
                "workspace_id" uuid NOT NULL,
                "kind" character varying NOT NULL,
                "name" character varying NOT NULL,
                "icon" character varying NOT NULL DEFAULT 'users',
                "is_private" boolean NOT NULL DEFAULT false,
                "agent_id" uuid,
                "member_id" uuid,
                "connection_id" character varying,
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "CHK_rooms_icon" CHECK (
                    "icon" IN ('users', 'sparkles', 'hourglass', 'inbox')
                ),
                CONSTRAINT "CHK_rooms_kind" CHECK ("kind" IN ('dm', 'channel')),
                CONSTRAINT "PK_0368a2d7c215f2d0458a54933f2" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_87232979ecee89faf09415de68" ON "rooms" ("workspace_id")
        `);
    await queryRunner.query(`
            CREATE UNIQUE INDEX "UQ_rooms_dm_member_agent" ON "rooms" ("member_id", "agent_id")
            WHERE "kind" = 'dm'
        `);
    await queryRunner.query(`
            CREATE TABLE "thread_reads" (
                "member_id" uuid NOT NULL,
                "chat_id" uuid NOT NULL,
                "last_read_at" TIMESTAMP WITH TIME ZONE NOT NULL,
                CONSTRAINT "PK_fddc28347eda9bc6bdd124c5b8e" PRIMARY KEY ("member_id", "chat_id")
            )
        `);
    await queryRunner.query(`
            CREATE TABLE "threads" (
                "id" uuid NOT NULL DEFAULT gen_random_uuid(),
                "workspace_id" uuid NOT NULL,
                "room_id" uuid NOT NULL,
                "name" character varying NOT NULL,
                "connection_id" character varying,
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "PK_d8a74804c34fc3900502cd27275" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_c6fcdfcd2f81d0729e575893ca" ON "threads" ("workspace_id")
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_34133cb0f02e6af927581de775" ON "threads" ("room_id")
        `);
    await queryRunner.query(`
            ALTER TABLE "assignments"
            ADD "tool_log" jsonb NOT NULL DEFAULT '[]'
        `);
    await queryRunner.query(`
            ALTER TABLE "assignments"
            ADD "turns" integer NOT NULL DEFAULT '0'
        `);
    await queryRunner.query(`
            ALTER TABLE "messages"
            ADD CONSTRAINT "FK_fb06c053a271467000dbd1d1dab" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "messages"
            ADD CONSTRAINT "FK_fbe82414de4c2be28f499b48463" FOREIGN KEY ("author_member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "messages"
            ADD CONSTRAINT "FK_f8a4ae44fe0c888e42443b7a520" FOREIGN KEY ("author_agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "messages"
            ADD CONSTRAINT "FK_33df3e4335238f007771c7198ce" FOREIGN KEY ("assignment_id") REFERENCES "assignments"("id") ON DELETE
            SET NULL ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "rooms"
            ADD CONSTRAINT "FK_87232979ecee89faf09415de686" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "rooms"
            ADD CONSTRAINT "FK_9f822ff88f1256c52e24e23dc4d" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "rooms"
            ADD CONSTRAINT "FK_750f50f3441072164ee46a4f595" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "thread_reads"
            ADD CONSTRAINT "FK_8da3a5c223334d8e13b6509b3d2" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "threads"
            ADD CONSTRAINT "FK_c6fcdfcd2f81d0729e575893cae" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "threads"
            ADD CONSTRAINT "FK_34133cb0f02e6af927581de775a" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE "threads" DROP CONSTRAINT "FK_34133cb0f02e6af927581de775a"
        `);
    await queryRunner.query(`
            ALTER TABLE "threads" DROP CONSTRAINT "FK_c6fcdfcd2f81d0729e575893cae"
        `);
    await queryRunner.query(`
            ALTER TABLE "thread_reads" DROP CONSTRAINT "FK_8da3a5c223334d8e13b6509b3d2"
        `);
    await queryRunner.query(`
            ALTER TABLE "rooms" DROP CONSTRAINT "FK_750f50f3441072164ee46a4f595"
        `);
    await queryRunner.query(`
            ALTER TABLE "rooms" DROP CONSTRAINT "FK_9f822ff88f1256c52e24e23dc4d"
        `);
    await queryRunner.query(`
            ALTER TABLE "rooms" DROP CONSTRAINT "FK_87232979ecee89faf09415de686"
        `);
    await queryRunner.query(`
            ALTER TABLE "messages" DROP CONSTRAINT "FK_33df3e4335238f007771c7198ce"
        `);
    await queryRunner.query(`
            ALTER TABLE "messages" DROP CONSTRAINT "FK_f8a4ae44fe0c888e42443b7a520"
        `);
    await queryRunner.query(`
            ALTER TABLE "messages" DROP CONSTRAINT "FK_fbe82414de4c2be28f499b48463"
        `);
    await queryRunner.query(`
            ALTER TABLE "messages" DROP CONSTRAINT "FK_fb06c053a271467000dbd1d1dab"
        `);
    await queryRunner.query(`
            ALTER TABLE "assignments" DROP COLUMN "turns"
        `);
    await queryRunner.query(`
            ALTER TABLE "assignments" DROP COLUMN "tool_log"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."IDX_34133cb0f02e6af927581de775"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."IDX_c6fcdfcd2f81d0729e575893ca"
        `);
    await queryRunner.query(`
            DROP TABLE "threads"
        `);
    await queryRunner.query(`
            DROP TABLE "thread_reads"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."UQ_rooms_dm_member_agent"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."IDX_87232979ecee89faf09415de68"
        `);
    await queryRunner.query(`
            DROP TABLE "rooms"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."IDX_messages_chat_created"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."IDX_messages_assignment"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."IDX_fb06c053a271467000dbd1d1da"
        `);
    await queryRunner.query(`
            DROP TABLE "messages"
        `);
  }
}
