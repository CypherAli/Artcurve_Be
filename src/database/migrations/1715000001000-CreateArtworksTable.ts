import { MigrationInterface, QueryRunner } from 'typeorm';

// Migration 002 â€” Táº¡o báº£ng artworks (phá»¥ thuá»™c users)
export class CreateArtworksTable1715000001000 implements MigrationInterface {
  public name = 'CreateArtworksTable1715000001000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Táº¡o enum type trÆ°á»›c
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "artwork_status_enum" AS ENUM (
          'DRAFT',
          'AI_MODERATING',
          'ACTIVE',
          'TARGET_REACHED',
          'GRADUATED'
        );
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "artworks" (
        "id"                  UUID              NOT NULL DEFAULT gen_random_uuid(),
        "creator_id"          UUID              NOT NULL,
        "contract_address"    VARCHAR(42),
        "title"               TEXT              NOT NULL,
        "description"         TEXT,
        "ipfs_metadata_uri"   TEXT,
        "status"              "artwork_status_enum" NOT NULL DEFAULT 'DRAFT',
        "target_cap"          DECIMAL(18,8)     NOT NULL DEFAULT 0,
        "current_supply"      DECIMAL(18,8)     NOT NULL DEFAULT 0,
        "current_price"       DECIMAL(18,8)     NOT NULL DEFAULT 0,
        "view_count"          INTEGER           NOT NULL DEFAULT 0,
        "created_at"          TIMESTAMPTZ       NOT NULL DEFAULT now(),
        "updated_at"          TIMESTAMPTZ       NOT NULL DEFAULT now(),

        CONSTRAINT "PK_artworks" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_artworks_contract_address" UNIQUE ("contract_address"),
        CONSTRAINT "FK_artworks_creator_id"
          FOREIGN KEY ("creator_id") REFERENCES "users"("id")
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT "CHK_artworks_target_cap" CHECK ("target_cap" > 0),
        CONSTRAINT "CHK_artworks_current_supply" CHECK ("current_supply" >= 0),
        CONSTRAINT "CHK_artworks_current_price" CHECK ("current_price" >= 0),
        CONSTRAINT "CHK_artworks_view_count" CHECK ("view_count" >= 0)
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_artworks_creator_id"
      ON "artworks" ("creator_id")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_artworks_status"
      ON "artworks" ("status")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_artworks_contract_address"
      ON "artworks" ("contract_address")
      WHERE "contract_address" IS NOT NULL
    `);

    // Covering index â€” há»— trá»£ query sáº¯p xáº¿p marketplace theo giÃ¡ vÃ  thá»i gian
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_artworks_active_price"
      ON "artworks" ("status", "current_price" DESC)
      WHERE "status" = 'ACTIVE'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_artworks_active_price"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_artworks_contract_address"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_artworks_status"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_artworks_creator_id"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "artworks"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "artwork_status_enum"`);
  }
}
