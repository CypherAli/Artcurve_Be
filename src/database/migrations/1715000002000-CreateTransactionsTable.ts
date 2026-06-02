import { MigrationInterface, QueryRunner } from 'typeorm';

// Migration 003 â€” Táº¡o báº£ng transactions (phá»¥ thuá»™c users + artworks)
// tx_hash lÃ  Idempotency Key chá»‘ng ghi Ä‘Ãºp tá»« blockchain indexer
export class CreateTransactionsTable1715000002000 implements MigrationInterface {
  public name = 'CreateTransactionsTable1715000002000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "transaction_type_enum" AS ENUM (
          'BUY', 'SELL', 'MINT', 'GRADUATE'
        );
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "transactions" (
        "id"              UUID                    NOT NULL DEFAULT gen_random_uuid(),
        "tx_hash"         VARCHAR(66)             NOT NULL,
        "user_id"         UUID                    NOT NULL,
        "artwork_id"      UUID                    NOT NULL,
        "tx_type"         "transaction_type_enum" NOT NULL,
        "share_amount"    DECIMAL(18,8)           NOT NULL,
        "eth_amount"      DECIMAL(18,8)           NOT NULL,
        "price_per_share" DECIMAL(18,8)           NOT NULL,
        "gas_fee"         DECIMAL(18,8),
        "block_number"    BIGINT,
        "timestamp"       TIMESTAMPTZ             NOT NULL,
        "created_at"      TIMESTAMPTZ             NOT NULL DEFAULT now(),

        CONSTRAINT "PK_transactions" PRIMARY KEY ("id"),

        -- tx_hash UNIQUE = Idempotency Key â€” blockchain indexer cÃ³ thá»ƒ gá»­i láº¡i event
        -- ON CONFLICT (tx_hash) DO NOTHING Ä‘á»ƒ cháº·n duplicate hoÃ n toÃ n
        CONSTRAINT "UQ_transactions_tx_hash" UNIQUE ("tx_hash"),

        CONSTRAINT "FK_transactions_user_id"
          FOREIGN KEY ("user_id") REFERENCES "users"("id")
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT "FK_transactions_artwork_id"
          FOREIGN KEY ("artwork_id") REFERENCES "artworks"("id")
          ON DELETE RESTRICT ON UPDATE CASCADE,

        CONSTRAINT "CHK_tx_share_amount" CHECK ("share_amount" > 0),
        CONSTRAINT "CHK_tx_eth_amount" CHECK ("eth_amount" > 0),
        CONSTRAINT "CHK_tx_price_per_share" CHECK ("price_per_share" >= 0)
      )
    `);

    // Idempotency key index â€” insert nhanh nhá» unique lookup
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "idx_transactions_tx_hash"
      ON "transactions" ("tx_hash")
    `);

    // Composite index theo ERD: idx_tx_history(artwork_id, timestamp)
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_tx_history"
      ON "transactions" ("artwork_id", "timestamp" DESC)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_transactions_user_id"
      ON "transactions" ("user_id")
    `);

    // Index riÃªng cho block_number â€” dÃ¹ng khi indexer cáº§n check Ä‘Ã£ xá»­ lÃ½ block nÃ o rá»“i
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_transactions_block_number"
      ON "transactions" ("block_number")
      WHERE "block_number" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_transactions_block_number"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_transactions_user_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_tx_history"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_transactions_tx_hash"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "transactions"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "transaction_type_enum"`);
  }
}
