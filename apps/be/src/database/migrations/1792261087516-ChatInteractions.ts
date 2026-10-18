import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Chat interactions: reactions, stored mentions, seq-based read state (room and thread
 * cursors), mutes, pins, and the `stopped` message status.
 *
 * Read state moves from timestamps to message `seq`: `thread_reads` (chat_id = thread root id)
 * keeps its rows with `last_read_seq` derived from the old `last_read_at`; the DM rows of
 * `thread_reads` (chat_id = a DM room id) become `room_reads`, and every existing room membership
 * gets a `room_reads` row at the room's current last seq, so nothing turns unread at deploy.
 * Afterwards a trigger on `room_members` gives every new member a cursor at the room's last seq
 * (also `joined_seq`: threads they never opened count only messages after it).
 */
export const CHAT_READS_BACKFILL: string[] = [
  `
    UPDATE "thread_reads" tr
    SET "last_read_seq" = coalesce((
          SELECT max(m."seq") FROM "messages" m
          WHERE (m."id" = tr."chat_id" OR m."parent_id" = tr."chat_id")
            AND m."created_at" <= tr."last_read_at"), 0),
        "updated_at" = tr."last_read_at"
  `,
  // DM read marks were stored by room id: they are room cursors now (rebuilt below for every DM).
  `DELETE FROM "thread_reads" tr USING "rooms" r WHERE r."id" = tr."chat_id" AND r."kind" = 'dm'`,
];

export const ROOM_READS_BACKFILL: string[] = [
  `
    INSERT INTO "room_reads" ("member_id", "room_id", "last_read_seq", "joined_seq")
    SELECT rm."member_id", rm."room_id",
           coalesce((SELECT max(m."seq") FROM "messages" m WHERE m."room_id" = rm."room_id"), 0), 0
    FROM "room_members" rm
    WHERE rm."member_id" IS NOT NULL
    ON CONFLICT DO NOTHING
  `,
  `
    INSERT INTO "room_reads" ("member_id", "room_id", "last_read_seq", "joined_seq")
    SELECT r."member_id", r."id",
           coalesce((SELECT max(m."seq") FROM "messages" m WHERE m."room_id" = r."id"), 0), 0
    FROM "rooms" r
    WHERE r."kind" = 'dm' AND r."member_id" IS NOT NULL
    ON CONFLICT DO NOTHING
  `,
];

export const JOIN_READ_FUNCTION = `
  CREATE FUNCTION "room_members_join_read"() RETURNS trigger AS $$
  BEGIN
    IF NEW."member_id" IS NOT NULL THEN
      INSERT INTO "room_reads" ("member_id", "room_id", "last_read_seq", "joined_seq")
      SELECT NEW."member_id", NEW."room_id", coalesce(max("seq"), 0), coalesce(max("seq"), 0)
      FROM "messages" WHERE "room_id" = NEW."room_id"
      ON CONFLICT ("member_id", "room_id") DO NOTHING;
    END IF;
    RETURN NEW;
  END
  $$ LANGUAGE plpgsql
`;

export class ChatInteractions1792261087516 implements MigrationInterface {
  name = 'ChatInteractions1792261087516';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            CREATE TABLE "message_mentions" (
                "id" uuid NOT NULL DEFAULT gen_random_uuid(),
                "message_id" uuid NOT NULL,
                "kind" character varying NOT NULL,
                "member_id" uuid,
                "agent_id" uuid,
                CONSTRAINT "CHK_message_mentions_kind" CHECK ("kind" IN ('member', 'agent', 'here')),
                CONSTRAINT "PK_6d3047d9fb0dd841366be90fb87" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_message_mentions_member" ON "message_mentions" ("member_id", "message_id")
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_message_mentions_message" ON "message_mentions" ("message_id")
        `);
    await queryRunner.query(`
            CREATE TABLE "message_reactions" (
                "id" uuid NOT NULL DEFAULT gen_random_uuid(),
                "workspace_id" uuid NOT NULL,
                "message_id" uuid NOT NULL,
                "member_id" uuid NOT NULL,
                "key" character varying(32) NOT NULL,
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "PK_654a9f0059ff93a8f156be66a5b" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_57efbd3e0a1c9680a14b5107fc" ON "message_reactions" ("workspace_id")
        `);
    await queryRunner.query(`
            CREATE UNIQUE INDEX "UQ_message_reactions_message_member_key" ON "message_reactions" ("message_id", "member_id", "key")
        `);
    await queryRunner.query(`
            CREATE TABLE "pins" (
                "id" uuid NOT NULL DEFAULT gen_random_uuid(),
                "member_id" uuid NOT NULL,
                "workspace_id" uuid NOT NULL,
                "target_type" character varying NOT NULL,
                "target_id" uuid NOT NULL,
                "room_id" uuid NOT NULL,
                "position" integer NOT NULL DEFAULT '0',
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "CHK_pins_target_type" CHECK ("target_type" IN ('room', 'thread', 'message')),
                CONSTRAINT "PK_a3e589ffd3c8c46861d011aede4" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_8e5a1b955d07da5c160ae4d9c9" ON "pins" ("workspace_id")
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_pins_member_position" ON "pins" ("member_id", "position")
        `);
    await queryRunner.query(`
            CREATE UNIQUE INDEX "UQ_pins_member_target" ON "pins" ("member_id", "target_type", "target_id")
        `);
    await queryRunner.query(`
            CREATE TABLE "room_mutes" (
                "member_id" uuid NOT NULL,
                "room_id" uuid NOT NULL,
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "PK_92dc6974117cb53f2907e79e5a6" PRIMARY KEY ("member_id", "room_id")
            )
        `);
    await queryRunner.query(`
            CREATE TABLE "room_reads" (
                "member_id" uuid NOT NULL,
                "room_id" uuid NOT NULL,
                "last_read_seq" bigint NOT NULL DEFAULT '0',
                "joined_seq" bigint NOT NULL DEFAULT '0',
                "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "PK_ab228f6443ee2a3da4908882146" PRIMARY KEY ("member_id", "room_id")
            )
        `);
    await queryRunner.query(`
            CREATE TABLE "thread_mutes" (
                "member_id" uuid NOT NULL,
                "root_id" uuid NOT NULL,
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "PK_99ffc6ba56f03a216b361576a0d" PRIMARY KEY ("member_id", "root_id")
            )
        `);
    await queryRunner.query(`
            ALTER TABLE "thread_reads"
            ADD "last_read_seq" bigint NOT NULL DEFAULT '0'
        `);
    await queryRunner.query(`
            ALTER TABLE "thread_reads"
            ADD "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
        `);
    for (const sql of CHAT_READS_BACKFILL) await queryRunner.query(sql);
    await queryRunner.query(`
            ALTER TABLE "thread_reads" DROP COLUMN "last_read_at"
        `);
    await queryRunner.query(`
            ALTER TABLE "message_mentions"
            ADD CONSTRAINT "FK_704c2dc52c37d26393dae070253" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "message_reactions"
            ADD CONSTRAINT "FK_57efbd3e0a1c9680a14b5107fcd" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "message_reactions"
            ADD CONSTRAINT "FK_ce61e365d81a9dfc15cd36513b0" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "message_reactions"
            ADD CONSTRAINT "FK_1799a6fb0d1a6bfdfc1b456f39a" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "pins"
            ADD CONSTRAINT "FK_294bdaf1f1dfc5296a73f5a1e5f" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "pins"
            ADD CONSTRAINT "FK_8e5a1b955d07da5c160ae4d9c9c" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "pins"
            ADD CONSTRAINT "FK_0e1816ba4e9126f4ae052a10c91" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "room_mutes"
            ADD CONSTRAINT "FK_b8361adaa81ed7642ec637acf7b" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "room_mutes"
            ADD CONSTRAINT "FK_018268767009f6a3a06cd8b2073" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "room_reads"
            ADD CONSTRAINT "FK_ec5eee0d1cb232253368b2ecc49" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "room_reads"
            ADD CONSTRAINT "FK_7bee194e0bae0e7d3b8ede3b471" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "thread_mutes"
            ADD CONSTRAINT "FK_2562a0d66e36cbef18d61f06b7c" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "thread_mutes"
            ADD CONSTRAINT "FK_dc5966eed42280a915ff836bf67" FOREIGN KEY ("root_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
    for (const sql of ROOM_READS_BACKFILL) await queryRunner.query(sql);
    await queryRunner.query(`ALTER TABLE "messages" DROP CONSTRAINT "CHK_messages_status"`);
    await queryRunner.query(`
            ALTER TABLE "messages"
            ADD CONSTRAINT "CHK_messages_status" CHECK ("status" IN ('streaming', 'complete', 'failed', 'stopped'))
        `);
    await queryRunner.query(JOIN_READ_FUNCTION);
    await queryRunner.query(`
            CREATE TRIGGER "trg_room_members_join_read"
            AFTER INSERT ON "room_members"
            FOR EACH ROW EXECUTE FUNCTION "room_members_join_read"()
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TRIGGER "trg_room_members_join_read" ON "room_members"`);
    await queryRunner.query(`DROP FUNCTION "room_members_join_read"()`);
    // A stopped reply was cut short: it reads as failed before this migration.
    await queryRunner.query(`UPDATE "messages" SET "status" = 'failed' WHERE "status" = 'stopped'`);
    await queryRunner.query(`ALTER TABLE "messages" DROP CONSTRAINT "CHK_messages_status"`);
    await queryRunner.query(`
            ALTER TABLE "messages"
            ADD CONSTRAINT "CHK_messages_status" CHECK ("status" IN ('streaming', 'complete', 'failed'))
        `);
    await queryRunner.query(`
            ALTER TABLE "thread_mutes" DROP CONSTRAINT "FK_dc5966eed42280a915ff836bf67"
        `);
    await queryRunner.query(`
            ALTER TABLE "thread_mutes" DROP CONSTRAINT "FK_2562a0d66e36cbef18d61f06b7c"
        `);
    await queryRunner.query(`
            ALTER TABLE "room_reads" DROP CONSTRAINT "FK_7bee194e0bae0e7d3b8ede3b471"
        `);
    await queryRunner.query(`
            ALTER TABLE "room_reads" DROP CONSTRAINT "FK_ec5eee0d1cb232253368b2ecc49"
        `);
    await queryRunner.query(`
            ALTER TABLE "room_mutes" DROP CONSTRAINT "FK_018268767009f6a3a06cd8b2073"
        `);
    await queryRunner.query(`
            ALTER TABLE "room_mutes" DROP CONSTRAINT "FK_b8361adaa81ed7642ec637acf7b"
        `);
    await queryRunner.query(`
            ALTER TABLE "pins" DROP CONSTRAINT "FK_0e1816ba4e9126f4ae052a10c91"
        `);
    await queryRunner.query(`
            ALTER TABLE "pins" DROP CONSTRAINT "FK_8e5a1b955d07da5c160ae4d9c9c"
        `);
    await queryRunner.query(`
            ALTER TABLE "pins" DROP CONSTRAINT "FK_294bdaf1f1dfc5296a73f5a1e5f"
        `);
    await queryRunner.query(`
            ALTER TABLE "message_reactions" DROP CONSTRAINT "FK_1799a6fb0d1a6bfdfc1b456f39a"
        `);
    await queryRunner.query(`
            ALTER TABLE "message_reactions" DROP CONSTRAINT "FK_ce61e365d81a9dfc15cd36513b0"
        `);
    await queryRunner.query(`
            ALTER TABLE "message_reactions" DROP CONSTRAINT "FK_57efbd3e0a1c9680a14b5107fcd"
        `);
    await queryRunner.query(`
            ALTER TABLE "message_mentions" DROP CONSTRAINT "FK_704c2dc52c37d26393dae070253"
        `);
    // The read marks come back as timestamps (the cursor's `updated_at`); DM cursors are lost.
    await queryRunner.query(`
            ALTER TABLE "thread_reads" ADD "last_read_at" TIMESTAMP WITH TIME ZONE
        `);
    await queryRunner.query(`UPDATE "thread_reads" SET "last_read_at" = "updated_at"`);
    await queryRunner.query(`
            ALTER TABLE "thread_reads" ALTER COLUMN "last_read_at" SET NOT NULL
        `);
    await queryRunner.query(`
            ALTER TABLE "thread_reads" DROP COLUMN "updated_at"
        `);
    await queryRunner.query(`
            ALTER TABLE "thread_reads" DROP COLUMN "last_read_seq"
        `);
    await queryRunner.query(`
            DROP TABLE "thread_mutes"
        `);
    await queryRunner.query(`
            DROP TABLE "room_reads"
        `);
    await queryRunner.query(`
            DROP TABLE "room_mutes"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."UQ_pins_member_target"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."IDX_pins_member_position"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."IDX_8e5a1b955d07da5c160ae4d9c9"
        `);
    await queryRunner.query(`
            DROP TABLE "pins"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."UQ_message_reactions_message_member_key"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."IDX_57efbd3e0a1c9680a14b5107fc"
        `);
    await queryRunner.query(`
            DROP TABLE "message_reactions"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."IDX_message_mentions_message"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."IDX_message_mentions_member"
        `);
    await queryRunner.query(`
            DROP TABLE "message_mentions"
        `);
  }
}
