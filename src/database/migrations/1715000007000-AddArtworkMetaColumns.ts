import { MigrationInterface, QueryRunner } from 'typeorm';

// Migration 008 — Thêm cột metadata cho artworks
// ticker, category, royalty_pct, curve_type, init_price
// Chạy sau migration 007 (ModerationLogs đã tồn tại)
export class AddArtworkMetaColumns1715000007000 implements MigrationInterface {
  public name = 'AddArtworkMetaColumns1715000007000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Tạo enum type cho bonding curve (idempotent)
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "curve_type_enum" AS ENUM ('linear', 'quadratic', 'exponential');
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$
    `);

    // 2. Thêm cột ticker — unique token symbol ($PALE, $BLOOM…)
    await queryRunner.query(`
      ALTER TABLE "artworks"
        ADD COLUMN IF NOT EXISTS "ticker"       VARCHAR(10),
        ADD COLUMN IF NOT EXISTS "category"     VARCHAR(50),
        ADD COLUMN IF NOT EXISTS "royalty_pct"  DECIMAL(5,2)      NOT NULL DEFAULT 5.00,
        ADD COLUMN IF NOT EXISTS "curve_type"   "curve_type_enum" NOT NULL DEFAULT 'quadratic',
        ADD COLUMN IF NOT EXISTS "init_price"   DECIMAL(18,8)     NOT NULL DEFAULT 0.00100000
    `);

    // 3. UNIQUE constraint cho ticker
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "artworks"
          ADD CONSTRAINT "UQ_artworks_ticker" UNIQUE ("ticker");
      EXCEPTION
        WHEN duplicate_table THEN NULL;
      END $$
    `);

    // 4. CHECK constraints
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "artworks"
          ADD CONSTRAINT "CHK_artworks_royalty_pct"
            CHECK ("royalty_pct" >= 0 AND "royalty_pct" <= 10);
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "artworks"
          ADD CONSTRAINT "CHK_artworks_init_price"
            CHECK ("init_price" > 0);
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$
    `);

    // 5. Index trên ticker (unique — tìm theo ticker nhanh)
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "idx_artworks_ticker"
      ON "artworks" ("ticker")
      WHERE "ticker" IS NOT NULL
    `);

    // 6. Index trên category (filter marketplace)
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_artworks_category"
      ON "artworks" ("category")
      WHERE "category" IS NOT NULL
    `);

    // 7. Composite index hỗ trợ search theo status + category
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_artworks_status_category"
      ON "artworks" ("status", "category")
      WHERE "status" = 'ACTIVE'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_artworks_status_category"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_artworks_category"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_artworks_ticker"`);
    await queryRunner.query(`ALTER TABLE "artworks" DROP CONSTRAINT IF EXISTS "CHK_artworks_init_price"`);
    await queryRunner.query(`ALTER TABLE "artworks" DROP CONSTRAINT IF EXISTS "CHK_artworks_royalty_pct"`);
    await queryRunner.query(`ALTER TABLE "artworks" DROP CONSTRAINT IF EXISTS "UQ_artworks_ticker"`);
    await queryRunner.query(`
      ALTER TABLE "artworks"
        DROP COLUMN IF EXISTS "init_price",
        DROP COLUMN IF EXISTS "curve_type",
        DROP COLUMN IF EXISTS "royalty_pct",
        DROP COLUMN IF EXISTS "category",
        DROP COLUMN IF EXISTS "ticker"
    `);
    await queryRunner.query(`DROP TYPE IF EXISTS "curve_type_enum"`);
  }
}
