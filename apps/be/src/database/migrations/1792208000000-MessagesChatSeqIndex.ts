import { MigrationInterface, QueryRunner } from 'typeorm';

export class MessagesChatSeqIndex1792208000000 implements MigrationInterface {
  name = 'MessagesChatSeqIndex1792208000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX "IDX_messages_chat_seq" ON "messages" ("chat_id", "seq")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_messages_chat_seq"`);
  }
}
