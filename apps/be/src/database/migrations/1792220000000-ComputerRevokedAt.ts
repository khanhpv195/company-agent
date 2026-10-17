import { MigrationInterface, QueryRunner } from 'typeorm';

export class ComputerRevokedAt1792220000000 implements MigrationInterface {
  name = 'ComputerRevokedAt1792220000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "computers" ADD "revoked_at" TIMESTAMP WITH TIME ZONE`);
    // A paired computer without a key was revoked (its last update is the closest time we have).
    await queryRunner.query(`
      UPDATE "computers" SET "revoked_at" = "updated_at"
      WHERE "api_key_hash" IS NULL AND "simulated" = false
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "computers" DROP COLUMN "revoked_at"`);
  }
}
