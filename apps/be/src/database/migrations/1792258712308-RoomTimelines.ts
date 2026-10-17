import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Chat model: every room has one main timeline and a thread is the set of replies to a root
 * message (`parent_id`). The old `threads` table is converted and dropped:
 *
 * - a thread whose first message is human or external (connection inbox) keeps that message as
 *   its root; its id becomes the old thread id, so every old chat id (URLs, tasks.chat_id,
 *   thread_reads, agent_sessions keys) stays valid as "the root message id";
 * - any other thread (empty, or an agent speaking first) gets a synthetic root authored by
 *   `external` "System" whose text is the thread name (its id is the old thread id too);
 * - the root carries `thread_title` = the old name, the other messages become replies in the
 *   same seq order; DM messages get `room_id` = the DM room and no parent;
 * - messages whose chat no longer exists (orphans of deleted rooms) are deleted.
 *
 * `down` rebuilds the old shape: one thread per titled/replied root (id = root id) and one
 * "General" thread per channel for the remaining main-timeline messages; soft-deleted messages
 * are dropped and replies inside DM threads are flattened into the DM.
 */
export const ROOM_TIMELINES_CONVERT: string[] = [
  // The first message of a human/external-started thread becomes the root: it takes the thread id.
  `
    UPDATE "messages" m SET "id" = r."thread_id"
    FROM (
      SELECT DISTINCT ON (m2."chat_id") m2."chat_id" AS "thread_id", m2."id" AS "first_id", m2."author_kind"
      FROM "messages" m2 JOIN "threads" t ON t."id" = m2."chat_id" AND m2."chat_kind" = 'thread'
      ORDER BY m2."chat_id", m2."seq"
    ) r
    WHERE m."id" = r."first_id" AND r."author_kind" IN ('human', 'external') AND m."id" <> r."thread_id"
  `,
  // Other threads get a synthetic root (placed just before the first reply when there is one).
  `
    INSERT INTO "messages" ("id", "workspace_id", "chat_id", "chat_kind", "room_id", "seq", "author_kind",
                            "external_name", "status", "markdown", "thread_title", "created_at")
    OVERRIDING SYSTEM VALUE
    SELECT t."id", t."workspace_id", t."id", 'thread', t."room_id", f."seq", 'external',
           'System', 'complete', t."name", t."name", LEAST(t."created_at", f."created_at")
    FROM "threads" t
    JOIN LATERAL (
      SELECT "seq", "created_at" FROM "messages"
      WHERE "chat_id" = t."id" AND "chat_kind" = 'thread' ORDER BY "seq" LIMIT 1
    ) f ON true
    WHERE NOT EXISTS (SELECT 1 FROM "messages" WHERE "id" = t."id")
  `,
  `
    INSERT INTO "messages" ("id", "workspace_id", "chat_id", "chat_kind", "room_id", "author_kind",
                            "external_name", "status", "markdown", "thread_title", "created_at")
    SELECT t."id", t."workspace_id", t."id", 'thread', t."room_id", 'external',
           'System', 'complete', t."name", t."name", t."created_at"
    FROM "threads" t
    WHERE NOT EXISTS (SELECT 1 FROM "messages" WHERE "id" = t."id")
  `,
  // Everything else of the thread becomes a reply.
  `
    UPDATE "messages" m SET "parent_id" = t."id", "room_id" = t."room_id"
    FROM "threads" t
    WHERE m."chat_id" = t."id" AND m."chat_kind" = 'thread' AND m."id" <> t."id"
  `,
  `
    UPDATE "messages" m SET "room_id" = t."room_id", "thread_title" = t."name"
    FROM "threads" t WHERE m."id" = t."id"
  `,
  `
    UPDATE "messages" m SET "room_id" = r."id"
    FROM "rooms" r WHERE m."chat_kind" = 'dm' AND r."id" = m."chat_id"
  `,
  `DELETE FROM "messages" WHERE "room_id" IS NULL`,
  `
    UPDATE "messages" r SET "reply_count" = c."n", "last_reply_at" = c."last"
    FROM (
      SELECT "parent_id", count(*)::int AS "n", max("created_at") AS "last"
      FROM "messages" WHERE "parent_id" IS NOT NULL GROUP BY "parent_id"
    ) c
    WHERE r."id" = c."parent_id"
  `,
];

export class RoomTimelines1792258712308 implements MigrationInterface {
  name = 'RoomTimelines1792258712308';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const column of [
      `"room_id" uuid`,
      `"parent_id" uuid`,
      `"thread_title" character varying`,
      `"reply_count" integer NOT NULL DEFAULT '0'`,
      `"last_reply_at" TIMESTAMP WITH TIME ZONE`,
      `"edited_at" TIMESTAMP WITH TIME ZONE`,
      `"deleted_at" TIMESTAMP WITH TIME ZONE`,
      `"client_message_id" character varying`,
      `"quote_message_id" uuid`,
    ]) {
      await queryRunner.query(`ALTER TABLE "messages" ADD ${column}`);
    }
    for (const sql of ROOM_TIMELINES_CONVERT) {
      await queryRunner.query(sql);
    }
    await queryRunner.query(`ALTER TABLE "messages" ALTER COLUMN "room_id" SET NOT NULL`);
    await queryRunner.query(`DROP INDEX "public"."IDX_messages_chat_created"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_messages_chat_seq"`);
    await queryRunner.query(`ALTER TABLE "messages" DROP CONSTRAINT "CHK_messages_chat_kind"`);
    await queryRunner.query(`ALTER TABLE "messages" DROP COLUMN "chat_id"`);
    await queryRunner.query(`ALTER TABLE "messages" DROP COLUMN "chat_kind"`);
    await queryRunner.query(`DROP TABLE "threads"`);
    await queryRunner.query(`
            CREATE UNIQUE INDEX "UQ_messages_client_id" ON "messages" (
                "room_id",
                "author_member_id",
                "client_message_id"
            )
            WHERE "client_message_id" IS NOT NULL
        `);
    await queryRunner.query(
      `CREATE INDEX "IDX_messages_parent_seq" ON "messages" ("parent_id", "seq")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_messages_room_seq" ON "messages" ("room_id", "seq")`,
    );
    await queryRunner.query(`
            ALTER TABLE "messages"
            ADD CONSTRAINT "FK_1dda4fc8dbeeff2ee71f0088ba0" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "messages"
            ADD CONSTRAINT "FK_932abe146b78bd584b4d1851ce3" FOREIGN KEY ("parent_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "messages"
            ADD CONSTRAINT "FK_e858862a5eed8d60d279e4677c7" FOREIGN KEY ("quote_message_id") REFERENCES "messages"("id") ON DELETE
            SET NULL ON UPDATE NO ACTION
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "messages" DROP CONSTRAINT "FK_e858862a5eed8d60d279e4677c7"`,
    );
    await queryRunner.query(
      `ALTER TABLE "messages" DROP CONSTRAINT "FK_932abe146b78bd584b4d1851ce3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "messages" DROP CONSTRAINT "FK_1dda4fc8dbeeff2ee71f0088ba0"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_messages_room_seq"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_messages_parent_seq"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_messages_client_id"`);

    // Soft-deleted messages (and, by cascade, the replies of a deleted root) are gone for good.
    await queryRunner.query(`DELETE FROM "messages" WHERE "deleted_at" IS NOT NULL`);

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
    await queryRunner.query(
      `CREATE INDEX "IDX_c6fcdfcd2f81d0729e575893ca" ON "threads" ("workspace_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_34133cb0f02e6af927581de775" ON "threads" ("room_id")`,
    );
    await queryRunner.query(`
            ALTER TABLE "threads"
            ADD CONSTRAINT "FK_c6fcdfcd2f81d0729e575893cae" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "threads"
            ADD CONSTRAINT "FK_34133cb0f02e6af927581de775a" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
    await queryRunner.query(`ALTER TABLE "messages" ADD "chat_id" uuid`);
    await queryRunner.query(`ALTER TABLE "messages" ADD "chat_kind" character varying`);

    // A DM keeps one flat chat (its threads are flattened into it).
    await queryRunner.query(`
            UPDATE "messages" m SET "chat_id" = m."room_id", "chat_kind" = 'dm'
            FROM "rooms" r WHERE r."id" = m."room_id" AND r."kind" = 'dm'
        `);
    // Every titled or replied root of a channel becomes a thread with its own id.
    await queryRunner.query(`
            INSERT INTO "threads" ("id", "workspace_id", "room_id", "name", "connection_id", "created_at")
            SELECT m."id", m."workspace_id", m."room_id",
                   COALESCE(NULLIF(left(m."thread_title", 120), ''), NULLIF(left(split_part(m."markdown", E'\\n', 1), 120), ''), 'Thread'),
                   r."connection_id", m."created_at"
            FROM "messages" m JOIN "rooms" r ON r."id" = m."room_id" AND r."kind" = 'channel'
            WHERE m."parent_id" IS NULL
              AND (m."thread_title" IS NOT NULL OR EXISTS (SELECT 1 FROM "messages" c WHERE c."parent_id" = m."id"))
        `);
    // The remaining main-timeline messages of a channel go to one "General" thread.
    await queryRunner.query(`
            INSERT INTO "threads" ("workspace_id", "room_id", "name", "connection_id", "created_at")
            SELECT m."workspace_id", m."room_id", 'General', r."connection_id", min(m."created_at")
            FROM "messages" m JOIN "rooms" r ON r."id" = m."room_id" AND r."kind" = 'channel'
            WHERE m."parent_id" IS NULL AND m."chat_id" IS NULL
              AND NOT EXISTS (SELECT 1 FROM "threads" t WHERE t."id" = m."id")
            GROUP BY m."workspace_id", m."room_id", r."connection_id"
        `);
    await queryRunner.query(`
            UPDATE "messages" m SET "chat_id" = m."id", "chat_kind" = 'thread'
            WHERE m."chat_id" IS NULL AND EXISTS (SELECT 1 FROM "threads" t WHERE t."id" = m."id")
        `);
    await queryRunner.query(`
            UPDATE "messages" m SET "chat_id" = m."parent_id", "chat_kind" = 'thread'
            WHERE m."chat_id" IS NULL AND m."parent_id" IS NOT NULL
              AND EXISTS (SELECT 1 FROM "threads" t WHERE t."id" = m."parent_id")
        `);
    await queryRunner.query(`
            UPDATE "messages" m SET "chat_id" = t."id", "chat_kind" = 'thread'
            FROM "threads" t
            WHERE m."chat_id" IS NULL AND t."room_id" = m."room_id" AND t."name" = 'General'
              AND t."id" NOT IN (SELECT "id" FROM "messages")
        `);

    await queryRunner.query(`ALTER TABLE "messages" ALTER COLUMN "chat_id" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE "messages" ALTER COLUMN "chat_kind" SET NOT NULL`);
    await queryRunner.query(`
            ALTER TABLE "messages" ADD CONSTRAINT "CHK_messages_chat_kind" CHECK (
                    (
                        (chat_kind)::text = ANY (
                            (
                                ARRAY ['dm'::character varying, 'thread'::character varying]
                            )::text []
                        )
                    )
                )
        `);
    await queryRunner.query(
      `CREATE INDEX "IDX_messages_chat_seq" ON "messages" USING btree ("chat_id", "seq")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_messages_chat_created" ON "messages" USING btree ("chat_id", "created_at")`,
    );
    for (const column of [
      'quote_message_id',
      'client_message_id',
      'deleted_at',
      'edited_at',
      'last_reply_at',
      'reply_count',
      'thread_title',
      'parent_id',
      'room_id',
    ]) {
      await queryRunner.query(`ALTER TABLE "messages" DROP COLUMN "${column}"`);
    }
  }
}
