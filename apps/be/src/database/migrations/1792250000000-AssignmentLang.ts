import { MigrationInterface, QueryRunner } from 'typeorm';

export class AssignmentLang1792250000000 implements MigrationInterface {
  name = 'AssignmentLang1792250000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE "assignments"
            ADD "lang" character varying(8)
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE "assignments" DROP COLUMN "lang"
        `);
  }
}
