import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Marks the synthetic "System" roots the RoomTimelines migration created for threads that had no
 * human or external first message (`messages.system_root`), so unread counts, previews and the
 * agent brief can skip them, and moves the roots of threads without any reply (they got a fresh
 * seq, i.e. the end of the room) to where their creation time puts them.
 *
 * A converted root is recognised by what only it has: external author "System" without a
 * connection, no member/agent author, no assignment, and a text equal to its thread title.
 */
export const SYSTEM_ROOT_BACKFILL: string[] = [
  `
    UPDATE "messages" SET "system_root" = true
    WHERE "author_kind" = 'external' AND "external_name" = 'System'
      AND "external_connection_id" IS NULL AND "author_member_id" IS NULL
      AND "author_agent_id" IS NULL AND "assignment_id" IS NULL
      AND "parent_id" IS NULL AND "thread_title" IS NOT NULL AND "markdown" = "thread_title"
  `,
  // Empty-thread roots (nothing replied, nothing quotes them): same row, `seq` of the last
  // real message of the room that is not newer than the root (0 when there is none). Ties on `seq`
  // are rare and harmless: only these placeholders can share one.
  `
    WITH "empty" AS (
      DELETE FROM "messages" m
      WHERE m."system_root"
        AND NOT EXISTS (SELECT 1 FROM "messages" c WHERE c."parent_id" = m."id")
        AND NOT EXISTS (SELECT 1 FROM "messages" q WHERE q."quote_message_id" = m."id")
      RETURNING m."id", m."workspace_id", m."room_id", m."thread_title", m."external_name",
                m."status", m."markdown", m."created_at"
    )
    INSERT INTO "messages" ("id", "workspace_id", "room_id", "seq", "thread_title", "author_kind",
                            "external_name", "status", "markdown", "created_at", "system_root")
    OVERRIDING SYSTEM VALUE
    SELECT e."id", e."workspace_id", e."room_id",
           coalesce((SELECT max(p."seq") FROM "messages" p
                     WHERE p."room_id" = e."room_id" AND p."created_at" <= e."created_at"
                       AND NOT p."system_root"), 0),
           e."thread_title", 'external', e."external_name", e."status", e."markdown",
           e."created_at", true
    FROM "empty" e
  `,
];

export class SystemRootMarker1792260194218 implements MigrationInterface {
  name = 'SystemRootMarker1792260194218';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "messages" ADD "system_root" boolean NOT NULL DEFAULT false`,
    );
    for (const sql of SYSTEM_ROOT_BACKFILL) {
      await queryRunner.query(sql);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "messages" DROP COLUMN "system_root"`);
  }
}
