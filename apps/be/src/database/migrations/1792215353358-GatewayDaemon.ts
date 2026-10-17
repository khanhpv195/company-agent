import { MigrationInterface, QueryRunner } from 'typeorm';

export class GatewayDaemon1792215353358 implements MigrationInterface {
  name = 'GatewayDaemon1792215353358';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            CREATE TABLE "agent_sessions" (
                "agent_id" uuid NOT NULL,
                "key" character varying NOT NULL,
                "session_id" uuid NOT NULL,
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "PK_6e3dbcc48f0e760832d05a553d2" PRIMARY KEY ("agent_id", "key")
            )
        `);
    await queryRunner.query(`
            CREATE TABLE "pairing_codes" (
                "id" uuid NOT NULL DEFAULT gen_random_uuid(),
                "workspace_id" uuid NOT NULL,
                "created_by" uuid,
                "code_hash" character(64) NOT NULL,
                "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
                "used_at" TIMESTAMP WITH TIME ZONE,
                CONSTRAINT "PK_08509f00aaa786863d624b68fb1" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_ec71ce8625b06ff57cf694d62b" ON "pairing_codes" ("workspace_id")
        `);
    await queryRunner.query(`
            CREATE UNIQUE INDEX "UQ_pairing_codes_code_hash" ON "pairing_codes" ("code_hash")
        `);
    await queryRunner.query(`
            ALTER TABLE "assignments"
            ADD "requested_by_member_id" uuid
        `);
    await queryRunner.query(`
            ALTER TABLE "assignments"
            ADD "cost_usd" numeric
        `);
    await queryRunner.query(`
            ALTER TABLE "assignments"
            ADD "num_turns" integer
        `);
    await queryRunner.query(`
            ALTER TABLE "tasks"
            ADD "created_by_member_id" uuid
        `);
    await queryRunner.query(`
            ALTER TABLE "assignments"
            ADD CONSTRAINT "FK_abfd65fe474ac960b62c50fbc5f" FOREIGN KEY ("requested_by_member_id") REFERENCES "members"("id") ON DELETE
            SET NULL ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "tasks"
            ADD CONSTRAINT "FK_78ab9d565fc2593e3b3d1c59dc8" FOREIGN KEY ("created_by_member_id") REFERENCES "members"("id") ON DELETE
            SET NULL ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "agent_sessions"
            ADD CONSTRAINT "FK_e17460dd4ac97818d81ace3fefc" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "pairing_codes"
            ADD CONSTRAINT "FK_ec71ce8625b06ff57cf694d62ba" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "pairing_codes"
            ADD CONSTRAINT "FK_4cc6a7811542b2af3e8d4f0be8d" FOREIGN KEY ("created_by") REFERENCES "members"("id") ON DELETE
            SET NULL ON UPDATE NO ACTION
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE "pairing_codes" DROP CONSTRAINT "FK_4cc6a7811542b2af3e8d4f0be8d"
        `);
    await queryRunner.query(`
            ALTER TABLE "pairing_codes" DROP CONSTRAINT "FK_ec71ce8625b06ff57cf694d62ba"
        `);
    await queryRunner.query(`
            ALTER TABLE "agent_sessions" DROP CONSTRAINT "FK_e17460dd4ac97818d81ace3fefc"
        `);
    await queryRunner.query(`
            ALTER TABLE "tasks" DROP CONSTRAINT "FK_78ab9d565fc2593e3b3d1c59dc8"
        `);
    await queryRunner.query(`
            ALTER TABLE "assignments" DROP CONSTRAINT "FK_abfd65fe474ac960b62c50fbc5f"
        `);
    await queryRunner.query(`
            ALTER TABLE "tasks" DROP COLUMN "created_by_member_id"
        `);
    await queryRunner.query(`
            ALTER TABLE "assignments" DROP COLUMN "num_turns"
        `);
    await queryRunner.query(`
            ALTER TABLE "assignments" DROP COLUMN "cost_usd"
        `);
    await queryRunner.query(`
            ALTER TABLE "assignments" DROP COLUMN "requested_by_member_id"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."UQ_pairing_codes_code_hash"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."IDX_ec71ce8625b06ff57cf694d62b"
        `);
    await queryRunner.query(`
            DROP TABLE "pairing_codes"
        `);
    await queryRunner.query(`
            DROP TABLE "agent_sessions"
        `);
  }
}
