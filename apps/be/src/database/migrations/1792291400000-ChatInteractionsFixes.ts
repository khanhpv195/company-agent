import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Fixes of `ChatInteractions`:
 * - the join trigger resets the cursor (`last_read_seq`, `joined_seq`) when a member rejoins a
 *   room, instead of keeping the old row (a huge unread count after rejoining);
 * - the backfill left `joined_seq = 0`, so threads a member never opened counted the whole
 *   history as unread. Rows still at 0 move to the room's last seq at migration time: nothing
 *   turns unread at deploy (threads never opened before count only what comes after).
 */
export class ChatInteractionsFixes1792291400000 implements MigrationInterface {
  name = 'ChatInteractionsFixes1792291400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "room_reads" rr
      SET "joined_seq" = coalesce((SELECT max(m."seq") FROM "messages" m WHERE m."room_id" = rr."room_id"), 0)
      WHERE rr."joined_seq" = 0
    `);
    await queryRunner.query(
      joinFunction(
        'DO UPDATE SET "last_read_seq" = EXCLUDED."last_read_seq", "joined_seq" = EXCLUDED."joined_seq", "updated_at" = now()',
      ),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(joinFunction('DO NOTHING'));
  }
}

const joinFunction = (conflict: string): string => `
  CREATE OR REPLACE FUNCTION "room_members_join_read"() RETURNS trigger AS $$
  BEGIN
    IF NEW."member_id" IS NOT NULL THEN
      INSERT INTO "room_reads" ("member_id", "room_id", "last_read_seq", "joined_seq")
      SELECT NEW."member_id", NEW."room_id", coalesce(max("seq"), 0), coalesce(max("seq"), 0)
      FROM "messages" WHERE "room_id" = NEW."room_id"
      ON CONFLICT ("member_id", "room_id") ${conflict};
    END IF;
    RETURN NEW;
  END
  $$ LANGUAGE plpgsql
`;
