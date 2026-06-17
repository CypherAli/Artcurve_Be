import { MigrationInterface, QueryRunner } from 'typeorm';

// Bổ sung cột cho màn tìm guild: level, max_members, acceptance.
export class AddGuildFinderColumns1718400000000 implements MigrationInterface {
  name = 'AddGuildFinderColumns1718400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE guilds ADD COLUMN IF NOT EXISTS level int NOT NULL DEFAULT 1`);
    await queryRunner.query(`ALTER TABLE guilds ADD COLUMN IF NOT EXISTS max_members int NOT NULL DEFAULT 30`);
    await queryRunner.query(`ALTER TABLE guilds ADD COLUMN IF NOT EXISTS acceptance varchar(10) NOT NULL DEFAULT 'auto'`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE guilds DROP COLUMN IF EXISTS acceptance`);
    await queryRunner.query(`ALTER TABLE guilds DROP COLUMN IF EXISTS max_members`);
    await queryRunner.query(`ALTER TABLE guilds DROP COLUMN IF EXISTS level`);
  }
}
