import { MigrationInterface, QueryRunner } from 'typeorm';

// Migration 006 â€” Báº£ng social_interactions (likes, comments, shares)
export class CreateSocialInteractionsTable1715000005000 implements MigrationInterface {
  public name = 'CreateSocialInteractionsTable1715000005000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "social_interactions" (
        "id"               UUID        NOT NULL DEFAULT gen_random_uuid(),
        "user_id"          UUID        NOT NULL,
        "artwork_id"       UUID        NOT NULL,
        "interaction_type" TEXT        NOT NULL,
        "content"          TEXT,
        "created_at"       TIMESTAMPTZ NOT NULL DEFAULT now(),

        CONSTRAINT "PK_social_interactions" PRIMARY KEY ("id"),

        CONSTRAINT "FK_social_user_id"
          FOREIGN KEY ("user_id") REFERENCES "users"("id")
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "FK_social_artwork_id"
          FOREIGN KEY ("artwork_id") REFERENCES "artworks"("id")
          ON DELETE CASCADE ON UPDATE CASCADE,

        CONSTRAINT "CHK_social_interaction_type"
          CHECK ("interaction_type" IN ('LIKE', 'COMMENT', 'SHARE', 'BOOKMARK'))
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_social_user_id"
      ON "social_interactions" ("user_id")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_social_artwork_id"
      ON "social_interactions" ("artwork_id")
    `);

    // Partial unique index: má»—i user chá»‰ LIKE má»™t artwork má»™t láº§n
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "idx_social_unique_like"
      ON "social_interactions" ("user_id", "artwork_id")
      WHERE "interaction_type" = 'LIKE'
    `);

    // Composite index cho query "táº¥t cáº£ comment cá»§a artwork X theo thá»i gian"
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_social_artwork_type"
      ON "social_interactions" ("artwork_id", "interaction_type", "created_at" DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_social_artwork_type"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_social_unique_like"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_social_artwork_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_social_user_id"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "social_interactions"`);
  }
}
