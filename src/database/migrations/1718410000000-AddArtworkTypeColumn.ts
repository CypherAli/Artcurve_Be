import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddArtworkTypeColumn1718410000000 implements MigrationInterface {
  name = 'AddArtworkTypeColumn1718410000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE artwork_type_enum AS ENUM ('ORIGINAL', 'AI_GENERATED', 'AI_ASSISTED')
    `);

    await queryRunner.query(`
      ALTER TABLE artworks
      ADD COLUMN IF NOT EXISTS artwork_type artwork_type_enum NOT NULL DEFAULT 'ORIGINAL'
    `);

    await queryRunner.query(`
      CREATE INDEX idx_artworks_artwork_type ON artworks (artwork_type)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_artworks_artwork_type`);
    await queryRunner.query(`ALTER TABLE artworks DROP COLUMN IF EXISTS artwork_type`);
    await queryRunner.query(`DROP TYPE IF EXISTS artwork_type_enum`);
  }
}
