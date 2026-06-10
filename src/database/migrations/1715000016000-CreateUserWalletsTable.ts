import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateUserWalletsTable1715000016000 implements MigrationInterface {
  name = 'CreateUserWalletsTable1715000016000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Multi-wallet: 1 tài khoản liên kết nhiều ví.
    // users.wallet_address vẫn là ví định danh gốc (primary);
    // user_wallets chứa TẤT CẢ ví của user (kể cả primary — backfill bên dưới).
    // wallet_address UNIQUE toàn cục: 1 ví chỉ thuộc đúng 1 tài khoản.
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS user_wallets (
        id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id        UUID         NOT NULL,
        wallet_address VARCHAR(42)  NOT NULL,
        label          VARCHAR(50)  NULL,
        is_primary     BOOLEAN      NOT NULL DEFAULT FALSE,
        created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),

        CONSTRAINT "FK_user_wallets_user_id"
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT "CHK_user_wallets_address_format"
          CHECK (wallet_address ~ '^0x[0-9a-f]{40}$')
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_user_wallets_address
      ON user_wallets (wallet_address)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_user_wallets_user_id
      ON user_wallets (user_id)
    `);
    // Mỗi user chỉ có đúng 1 ví primary
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_user_wallets_one_primary
      ON user_wallets (user_id) WHERE is_primary
    `);

    // Backfill: ví hiện tại của mỗi user trở thành ví primary đã liên kết
    await queryRunner.query(`
      INSERT INTO user_wallets (user_id, wallet_address, is_primary)
      SELECT id, wallet_address, TRUE FROM users
      ON CONFLICT (wallet_address) DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS user_wallets`);
  }
}
