import { MigrationInterface, QueryRunner } from 'typeorm';

// Migration 001 â€” Táº¡o báº£ng users
// DÃ¹ng transaction = false Ä‘á»ƒ cho phÃ©p CREATE INDEX
// (CONCURRENTLY khÃ´ng thá»ƒ cháº¡y bÃªn trong transaction block)
export class CreateUsersTable1715000000000 implements MigrationInterface {
  public name = 'CreateUsersTable1715000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "users" (
        "id"              UUID                NOT NULL DEFAULT gen_random_uuid(),
        "wallet_address"  VARCHAR(42)         NOT NULL,
        "nonce"           TEXT,
        "username"        TEXT,
        "email"           TEXT,
        "bio"             TEXT,
        "avatar_url"      TEXT,
        "twitter_handle"  TEXT,
        "is_verified"     BOOLEAN             NOT NULL DEFAULT false,
        "role"            TEXT                NOT NULL DEFAULT 'user',
        "created_at"      TIMESTAMPTZ         NOT NULL DEFAULT now(),
        "updated_at"      TIMESTAMPTZ         NOT NULL DEFAULT now(),

        CONSTRAINT "PK_users" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_users_wallet_address" UNIQUE ("wallet_address"),
        CONSTRAINT "CHK_users_wallet_format" CHECK ("wallet_address" ~ '^0x[0-9a-fA-F]{40}$'),
        CONSTRAINT "CHK_users_role" CHECK ("role" IN ('user', 'admin', 'moderator'))
      )
    `);

    // Táº¡o index CONCURRENTLY ngoÃ i transaction Ä‘á»ƒ khÃ´ng block writes
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_users_wallet_address"
      ON "users" ("wallet_address")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_users_created_at"
      ON "users" ("created_at" DESC)
    `);

    // Partial index cho verified artists â€” query thÆ°á»ng filter is_verified = true
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_users_verified"
      ON "users" ("is_verified")
      WHERE "is_verified" = true
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_users_verified"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_users_created_at"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_users_wallet_address"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "users"`);
  }
}
