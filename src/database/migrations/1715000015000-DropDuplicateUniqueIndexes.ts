import { MigrationInterface, QueryRunner } from 'typeorm';

export class DropDuplicateUniqueIndexes1715000015000 implements MigrationInterface {
  name = 'DropDuplicateUniqueIndexes1715000015000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Migration cũ tạo UNIQUE CONSTRAINT (UQ_*) song song với UNIQUE INDEX
    // (idx_*) do entity khai báo → mỗi cột bị 2 index giống hệt nhau,
    // tốn gấp đôi chi phí write + storage. Giữ lại đúng 1 index unique
    // theo tên entity khai báo, bỏ bản trùng.

    // transactions.tx_hash: idx_transactions_tx_hash (unique) đã đủ
    await queryRunner.query(`
      ALTER TABLE transactions DROP CONSTRAINT IF EXISTS "UQ_transactions_tx_hash"
    `);

    // artworks.ticker: idx_artworks_ticker (unique partial) đã đủ
    await queryRunner.query(`
      ALTER TABLE artworks DROP CONSTRAINT IF EXISTS "UQ_artworks_ticker"
    `);

    // followers (follower_id, following_id): idx_follow (unique) đã đủ
    await queryRunner.query(`
      ALTER TABLE followers DROP CONSTRAINT IF EXISTS "UQ_followers_pair"
    `);

    // users.wallet_address: DB có UQ_ (unique) + idx_ (KHÔNG unique).
    // Entity muốn idx_users_wallet_address unique → bỏ cả 2, tạo lại 1 cái đúng.
    await queryRunner.query(`DROP INDEX IF EXISTS idx_users_wallet_address`);
    await queryRunner.query(`
      ALTER TABLE users DROP CONSTRAINT IF EXISTS "UQ_users_wallet_address"
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_users_wallet_address
      ON users (wallet_address)
    `);

    // artworks.contract_address: DB có UQ_ (unique) + idx_ (KHÔNG unique, partial).
    // Entity muốn idx_artworks_contract_address unique → bỏ cả 2, tạo lại 1 cái đúng.
    await queryRunner.query(`DROP INDEX IF EXISTS idx_artworks_contract_address`);
    await queryRunner.query(`
      ALTER TABLE artworks DROP CONSTRAINT IF EXISTS "UQ_artworks_contract_address"
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_artworks_contract_address
      ON artworks (contract_address)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Khôi phục các UNIQUE CONSTRAINT cũ (idx_* vẫn tồn tại song song như trước)
    await queryRunner.query(`
      ALTER TABLE transactions ADD CONSTRAINT "UQ_transactions_tx_hash" UNIQUE (tx_hash)
    `);
    await queryRunner.query(`
      ALTER TABLE artworks ADD CONSTRAINT "UQ_artworks_ticker" UNIQUE (ticker)
    `);
    await queryRunner.query(`
      ALTER TABLE followers ADD CONSTRAINT "UQ_followers_pair" UNIQUE (follower_id, following_id)
    `);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_users_wallet_address`);
    await queryRunner.query(`
      ALTER TABLE users ADD CONSTRAINT "UQ_users_wallet_address" UNIQUE (wallet_address)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_users_wallet_address ON users (wallet_address)
    `);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_artworks_contract_address`);
    await queryRunner.query(`
      ALTER TABLE artworks ADD CONSTRAINT "UQ_artworks_contract_address" UNIQUE (contract_address)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_artworks_contract_address
      ON artworks (contract_address) WHERE contract_address IS NOT NULL
    `);
  }
}
