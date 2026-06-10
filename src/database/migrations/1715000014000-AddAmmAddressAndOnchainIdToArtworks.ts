import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAmmAddressAndOnchainIdToArtworks1715000014000 implements MigrationInterface {
  name = 'AddAmmAddressAndOnchainIdToArtworks1715000014000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 2 cột này đã có trong Artwork entity và được BlockchainEventConsumer /
    // indexer sử dụng, nhưng chưa từng có migration tạo chúng → mọi query
    // SELECT/UPDATE đụng tới amm_address / onchain_id sẽ fail trên DB sạch.

    // amm_address: địa chỉ AMM clone — map Trade event → artwork UUID.
    // UNIQUE để lookup O(1); Postgres cho phép nhiều NULL trong unique index.
    await queryRunner.query(`
      ALTER TABLE artworks
      ADD COLUMN IF NOT EXISTS amm_address VARCHAR(42) NULL
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_artworks_amm_address
      ON artworks (amm_address)
    `);

    // onchain_id: sequential ID từ smart contract (uint256 → string).
    await queryRunner.query(`
      ALTER TABLE artworks
      ADD COLUMN IF NOT EXISTS onchain_id VARCHAR(78) NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_artworks_onchain_id
      ON artworks (onchain_id)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_artworks_onchain_id`);
    await queryRunner.query(`
      ALTER TABLE artworks DROP COLUMN IF EXISTS onchain_id
    `);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_artworks_amm_address`);
    await queryRunner.query(`
      ALTER TABLE artworks DROP COLUMN IF EXISTS amm_address
    `);
  }
}
