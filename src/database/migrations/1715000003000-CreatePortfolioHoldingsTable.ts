import { MigrationInterface, QueryRunner } from 'typeorm';

// Migration 004 â€” Báº£ng portfolio_holdings
// Upsert-friendly: ON CONFLICT (user_id, artwork_id) DO UPDATE share_balance
export class CreatePortfolioHoldingsTable1715000003000 implements MigrationInterface {
  public name = 'CreatePortfolioHoldingsTable1715000003000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "portfolio_holdings" (
        "id"            UUID          NOT NULL DEFAULT gen_random_uuid(),
        "user_id"       UUID          NOT NULL,
        "artwork_id"    UUID          NOT NULL,
        "share_balance" DECIMAL(18,8) NOT NULL DEFAULT 0,
        "avg_buy_price" DECIMAL(18,8) NOT NULL DEFAULT 0,
        "created_at"    TIMESTAMPTZ   NOT NULL DEFAULT now(),
        "updated_at"    TIMESTAMPTZ   NOT NULL DEFAULT now(),

        CONSTRAINT "PK_portfolio_holdings" PRIMARY KEY ("id"),

        CONSTRAINT "FK_portfolio_user_id"
          FOREIGN KEY ("user_id") REFERENCES "users"("id")
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "FK_portfolio_artwork_id"
          FOREIGN KEY ("artwork_id") REFERENCES "artworks"("id")
          ON DELETE RESTRICT ON UPDATE CASCADE,

        CONSTRAINT "CHK_portfolio_share_balance" CHECK ("share_balance" >= 0),
        CONSTRAINT "CHK_portfolio_avg_buy_price" CHECK ("avg_buy_price" >= 0)
      )
    `);

    // Composite index theo ERD: idx_user_portfolio(user_id, artwork_id)
    // CÅ©ng lÃ  conflict target cho upsert pattern
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "idx_user_portfolio"
      ON "portfolio_holdings" ("user_id", "artwork_id")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_portfolio_artwork_id"
      ON "portfolio_holdings" ("artwork_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_portfolio_artwork_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_user_portfolio"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "portfolio_holdings"`);
  }
}
