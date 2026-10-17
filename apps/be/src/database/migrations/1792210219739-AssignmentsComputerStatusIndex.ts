import { MigrationInterface, QueryRunner } from 'typeorm';

export class AssignmentsComputerStatusIndex1792210219739 implements MigrationInterface {
  name = 'AssignmentsComputerStatusIndex1792210219739';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            CREATE INDEX "IDX_assignments_computer_status" ON "assignments" ("computer_id", "status")
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            DROP INDEX "public"."IDX_assignments_computer_status"
        `);
  }
}
