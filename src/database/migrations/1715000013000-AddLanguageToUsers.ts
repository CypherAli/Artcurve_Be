import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddLanguageToUsers1715000013000 implements MigrationInterface {
  name = 'AddLanguageToUsers1715000013000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN IF NOT EXISTS "language" VARCHAR(10) NOT NULL DEFAULT 'en'
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users" DROP COLUMN IF EXISTS "language"
    `);
  }
}
