import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateGuildTables1715000018000 implements MigrationInterface {
  public name = 'CreateGuildTables1715000018000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── Create enum type for guild member roles ─────────────────────────────
    await queryRunner.query(`
      CREATE TYPE "guild_role_enum" AS ENUM ('owner', 'moderator', 'member')
    `);

    // ── guilds table ────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "guilds" (
        "id"           UUID         NOT NULL DEFAULT gen_random_uuid(),
        "name"         VARCHAR(64)  NOT NULL,
        "description"  VARCHAR(255),
        "focus"        VARCHAR(32)  NOT NULL,
        "creator_id"   UUID         NOT NULL,
        "member_count" INT          NOT NULL DEFAULT 1,
        "avatar_color" VARCHAR(7),
        "created_at"   TIMESTAMPTZ  NOT NULL DEFAULT now(),
        "updated_at"   TIMESTAMPTZ  NOT NULL DEFAULT now(),

        CONSTRAINT "PK_guilds" PRIMARY KEY ("id"),

        CONSTRAINT "FK_guilds_creator_id"
          FOREIGN KEY ("creator_id") REFERENCES "users"("id")
          ON DELETE CASCADE ON UPDATE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_guilds_focus"
      ON "guilds" ("focus")
    `);

    // ── guild_members table ─────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "guild_members" (
        "id"        UUID            NOT NULL DEFAULT gen_random_uuid(),
        "guild_id"  UUID            NOT NULL,
        "user_id"   UUID            NOT NULL,
        "role"      guild_role_enum NOT NULL DEFAULT 'member',
        "joined_at" TIMESTAMPTZ     NOT NULL DEFAULT now(),

        CONSTRAINT "PK_guild_members" PRIMARY KEY ("id"),

        CONSTRAINT "UQ_guild_member" UNIQUE ("guild_id", "user_id"),

        CONSTRAINT "FK_guild_members_guild_id"
          FOREIGN KEY ("guild_id") REFERENCES "guilds"("id")
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "FK_guild_members_user_id"
          FOREIGN KEY ("user_id") REFERENCES "users"("id")
          ON DELETE CASCADE ON UPDATE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "idx_guild_member"
      ON "guild_members" ("guild_id", "user_id")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_guild_members_user_id"
      ON "guild_members" ("user_id")
    `);

    // ── guild_messages table ────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "guild_messages" (
        "id"         UUID         NOT NULL DEFAULT gen_random_uuid(),
        "guild_id"   UUID         NOT NULL,
        "user_id"    UUID         NOT NULL,
        "user_name"  VARCHAR(64)  NOT NULL,
        "content"    VARCHAR(500) NOT NULL,
        "created_at" TIMESTAMPTZ  NOT NULL DEFAULT now(),

        CONSTRAINT "PK_guild_messages" PRIMARY KEY ("id"),

        CONSTRAINT "FK_guild_messages_guild_id"
          FOREIGN KEY ("guild_id") REFERENCES "guilds"("id")
          ON DELETE CASCADE ON UPDATE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_guild_message_guild"
      ON "guild_messages" ("guild_id")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_guild_messages_created"
      ON "guild_messages" ("guild_id", "created_at" DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_guild_messages_created"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_guild_message_guild"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "guild_messages"`);

    await queryRunner.query(`DROP INDEX IF EXISTS "idx_guild_members_user_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_guild_member"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "guild_members"`);

    await queryRunner.query(`DROP INDEX IF EXISTS "idx_guilds_focus"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "guilds"`);

    await queryRunner.query(`DROP TYPE IF EXISTS "guild_role_enum"`);
  }
}
