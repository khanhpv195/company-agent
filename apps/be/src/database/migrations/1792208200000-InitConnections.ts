import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitConnections1792208200000 implements MigrationInterface {
  name = 'InitConnections1792208200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            CREATE TABLE "workspace_connections" (
                "workspace_id" uuid NOT NULL,
                "provider" character varying NOT NULL,
                "status" character varying NOT NULL DEFAULT 'off',
                "account" character varying,
                "room_name" character varying NOT NULL,
                "room_id" uuid,
                "agent_id" uuid,
                "mode" character varying NOT NULL DEFAULT 'draft',
                "connected_at" TIMESTAMP WITH TIME ZONE,
                CONSTRAINT "CHK_workspace_connections_mode" CHECK ("mode" IN ('draft', 'auto')),
                CONSTRAINT "CHK_workspace_connections_status" CHECK ("status" IN ('on', 'off')),
                CONSTRAINT "CHK_workspace_connections_provider" CHECK ("provider" IN ('zalo', 'facebook', 'gmail')),
                CONSTRAINT "PK_cf47a0c07ab2528e595d0275f0b" PRIMARY KEY ("workspace_id", "provider")
            )
        `);
    await queryRunner.query(`
            ALTER TABLE "workspace_connections"
            ADD CONSTRAINT "FK_265952431c4d262ebb716e93bfa" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "workspace_connections"
            ADD CONSTRAINT "FK_34e424821cad5f300f2fe30ba2f" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE
            SET NULL ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "workspace_connections"
            ADD CONSTRAINT "FK_6f904393b780fd3e2197d89d8df" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE
            SET NULL ON UPDATE NO ACTION
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE "workspace_connections" DROP CONSTRAINT "FK_6f904393b780fd3e2197d89d8df"
        `);
    await queryRunner.query(`
            ALTER TABLE "workspace_connections" DROP CONSTRAINT "FK_34e424821cad5f300f2fe30ba2f"
        `);
    await queryRunner.query(`
            ALTER TABLE "workspace_connections" DROP CONSTRAINT "FK_265952431c4d262ebb716e93bfa"
        `);
    await queryRunner.query(`
            DROP TABLE "workspace_connections"
        `);
  }
}
