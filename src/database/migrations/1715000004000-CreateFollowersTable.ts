import { MigrationInterface, QueryRunner } from 'typeorm';

// Migration 005 â€” Báº£ng followers (self-referential relationship trÃªn users)
export class CreateFollowersTable1715000004000 implements MigrationInterface {
  public name = 'CreateFollowersTable1715000004000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "followers" (
        "id"           UUID        NOT NULL DEFAULT gen_random_uuid(),
        "follower_id"  UUID        NOT NULL,
        "following_id" UUID        NOT NULL,
        "created_at"   TIMESTAMPTZ NOT NULL DEFAULT now(),

        CONSTRAINT "PK_followers" PRIMARY KEY ("id"),

        -- Unique theo ERD: idx_follow(follower_id, following_id)
        CONSTRAINT "UQ_followers_pair" UNIQUE ("follower_id", "following_id"),

        CONSTRAINT "FK_followers_follower_id"
          FOREIGN KEY ("follower_id") REFERENCES "users"("id")
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "FK_followers_following_id"
          FOREIGN KEY ("following_id") REFERENCES "users"("id")
          ON DELETE CASCADE ON UPDATE CASCADE,

        -- NgÄƒn tá»± follow chÃ­nh mÃ¬nh
        CONSTRAINT "CHK_followers_no_self_follow"
          CHECK ("follower_id" <> "following_id")
      )
    `);

    // Composite unique index theo ERD
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "idx_follow"
      ON "followers" ("follower_id", "following_id")
    `);

    // Index ngÆ°á»£c Ä‘á»ƒ query "ai Ä‘ang follow user X" nhanh
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_followers_following_id"
      ON "followers" ("following_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_followers_following_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_follow"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "followers"`);
  }
}
