import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `rooms.is_default` marks the channel every new member joins (it was found by the name
 * "all-members" before), and a case-insensitive unique index keeps channel names unique per
 * workspace. The index is an expression index, which TypeORM cannot diff, so the entity
 * declares it with `synchronize: false`.
 */
export class RoomsDefaultAndNames1792257668269 implements MigrationInterface {
  name = 'RoomsDefaultAndNames1792257668269';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Existing duplicates (same name ignoring case) keep the oldest; the others get " (2)", " (3)"...
    const channels = (await queryRunner.query(
      `SELECT "id", "workspace_id", "name" FROM "rooms" WHERE "kind" = 'channel'
       ORDER BY "created_at" ASC, "id" ASC`,
    )) as { id: string; workspace_id: string; name: string }[];
    const taken = new Set<string>();
    const key = (workspaceId: string, name: string) => `${workspaceId}:${name.toLowerCase()}`;
    const duplicates: typeof channels = [];
    for (const channel of channels) {
      const k = key(channel.workspace_id, channel.name);
      if (taken.has(k)) duplicates.push(channel);
      else taken.add(k);
    }
    for (const channel of duplicates) {
      for (let n = 2; ; n++) {
        const suffix = ` (${n})`;
        const candidate = `${channel.name.slice(0, 80 - suffix.length)}${suffix}`;
        const k = key(channel.workspace_id, candidate);
        if (taken.has(k)) continue;
        taken.add(k);
        await queryRunner.query(`UPDATE "rooms" SET "name" = $2 WHERE "id" = $1`, [
          channel.id,
          candidate,
        ]);
        break;
      }
    }
    await queryRunner.query(`
            ALTER TABLE "rooms" ADD "is_default" boolean NOT NULL DEFAULT false
        `);
    // The workspace's channel named all-members (the oldest one) becomes the default.
    await queryRunner.query(`
            UPDATE "rooms" SET "is_default" = true
            WHERE "id" IN (
              SELECT DISTINCT ON ("workspace_id") "id" FROM "rooms"
              WHERE "kind" = 'channel' AND "connection_id" IS NULL AND lower("name") = 'all-members'
              ORDER BY "workspace_id", "created_at" ASC, "id" ASC
            )
        `);
    await queryRunner.query(`
            CREATE UNIQUE INDEX "UQ_rooms_channel_name_ci" ON "rooms" ("workspace_id", lower("name"))
            WHERE "kind" = 'channel'
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            DROP INDEX "public"."UQ_rooms_channel_name_ci"
        `);
    await queryRunner.query(`
            ALTER TABLE "rooms" DROP COLUMN "is_default"
        `);
  }
}
