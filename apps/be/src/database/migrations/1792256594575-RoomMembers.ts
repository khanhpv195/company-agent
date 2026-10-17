import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Backfill of the existing channels (the e2e spec runs it too). Channels were visible to every
 * member before, so every live member and every live agent joins every existing channel
 * (private ones included: that is exactly who could see them). Workspace owners become room
 * owners. A connection inbox gets all live members plus its connection's agent.
 */
export const ROOM_MEMBERS_BACKFILL: string[] = [
  `
            INSERT INTO "room_members" ("workspace_id", "room_id", "member_id", "role")
            SELECT r."workspace_id", r."id", m."id",
                   CASE WHEN m."role" = 'owner' THEN 'owner' ELSE 'member' END
            FROM "rooms" r
            JOIN "members" m ON m."workspace_id" = r."workspace_id" AND m."removed_at" IS NULL
            WHERE r."kind" = 'channel'
        `,
  `
            INSERT INTO "room_members" ("workspace_id", "room_id", "agent_id", "role")
            SELECT r."workspace_id", r."id", a."id", 'member'
            FROM "rooms" r
            JOIN "agents" a ON a."workspace_id" = r."workspace_id" AND a."deleted_at" IS NULL
            WHERE r."kind" = 'channel' AND r."connection_id" IS NULL
        `,
  `
            INSERT INTO "room_members" ("workspace_id", "room_id", "agent_id", "role")
            SELECT r."workspace_id", r."id", a."id", 'member'
            FROM "rooms" r
            JOIN "workspace_connections" c
              ON c."workspace_id" = r."workspace_id" AND c."provider" = r."connection_id"
            JOIN "agents" a ON a."id" = c."agent_id" AND a."deleted_at" IS NULL
            WHERE r."kind" = 'channel' AND r."connection_id" IS NOT NULL
        `,
];

export class RoomMembers1792256594575 implements MigrationInterface {
  name = 'RoomMembers1792256594575';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            CREATE TABLE "room_members" (
                "id" uuid NOT NULL DEFAULT gen_random_uuid(),
                "workspace_id" uuid NOT NULL,
                "room_id" uuid NOT NULL,
                "member_id" uuid,
                "agent_id" uuid,
                "role" character varying NOT NULL DEFAULT 'member',
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "CHK_room_members_role" CHECK ("role" IN ('owner', 'member')),
                CONSTRAINT "CHK_room_members_one_party" CHECK (("member_id" IS NULL) <> ("agent_id" IS NULL)),
                CONSTRAINT "PK_4493fab0433f741b7cf842e6038" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_52140de482e719874353ea9926" ON "room_members" ("workspace_id")
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_room_members_member" ON "room_members" ("member_id")
        `);
    await queryRunner.query(`
            CREATE UNIQUE INDEX "UQ_room_members_room_agent" ON "room_members" ("room_id", "agent_id")
            WHERE "agent_id" IS NOT NULL
        `);
    await queryRunner.query(`
            CREATE UNIQUE INDEX "UQ_room_members_room_member" ON "room_members" ("room_id", "member_id")
            WHERE "member_id" IS NOT NULL
        `);
    await queryRunner.query(`
            ALTER TABLE "room_members"
            ADD CONSTRAINT "FK_52140de482e719874353ea99262" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "room_members"
            ADD CONSTRAINT "FK_e6cf45f179a524427ddf8bacd8e" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "room_members"
            ADD CONSTRAINT "FK_19b9871aa27cb2a7b0a26c41e65" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "room_members"
            ADD CONSTRAINT "FK_eca6550d2811ecab24c3980dcb7" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
    for (const sql of ROOM_MEMBERS_BACKFILL) {
      await queryRunner.query(sql);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE "room_members" DROP CONSTRAINT "FK_eca6550d2811ecab24c3980dcb7"
        `);
    await queryRunner.query(`
            ALTER TABLE "room_members" DROP CONSTRAINT "FK_19b9871aa27cb2a7b0a26c41e65"
        `);
    await queryRunner.query(`
            ALTER TABLE "room_members" DROP CONSTRAINT "FK_e6cf45f179a524427ddf8bacd8e"
        `);
    await queryRunner.query(`
            ALTER TABLE "room_members" DROP CONSTRAINT "FK_52140de482e719874353ea99262"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."UQ_room_members_room_member"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."UQ_room_members_room_agent"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."IDX_room_members_member"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."IDX_52140de482e719874353ea9926"
        `);
    await queryRunner.query(`
            DROP TABLE "room_members"
        `);
  }
}
