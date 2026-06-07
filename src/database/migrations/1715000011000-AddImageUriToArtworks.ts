import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddImageUriToArtworks1715000011000 implements MigrationInterface {
  name = 'AddImageUriToArtworks1715000011000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Thêm cột image_uri để lưu trực tiếp IPFS image URI.
    // Giúp FE render thumbnail marketplace mà không cần fetch từng IPFS metadata.
    await queryRunner.query(`
      ALTER TABLE artworks
      ADD COLUMN IF NOT EXISTS image_uri TEXT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE artworks DROP COLUMN IF EXISTS image_uri
    `);
  }
}
