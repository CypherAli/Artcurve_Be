import { MigrationInterface, QueryRunner } from 'typeorm';

// Migration 007 â€” Báº£ng moderation_logs (audit trail cho AI + admin moderation)
export class CreateModerationLogsTable1715000006000 implements MigrationInterface {
  public name = 'CreateModerationLogsTable1715000006000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "moderation_logs" (
        "id"                   UUID          NOT NULL DEFAULT gen_random_uuid(),
        "artwork_id"           UUID          NOT NULL,
        "admin_id"             UUID,
        "ai_confidence_score"  DECIMAL(5,2)  NOT NULL,
        "action_taken"         TEXT          NOT NULL,
        "reason"               TEXT,
        "created_at"           TIMESTAMPTZ   NOT NULL DEFAULT now(),

        CONSTRAINT "PK_moderation_logs" PRIMARY KEY ("id"),

        CONSTRAINT "FK_moderation_artwork_id"
          FOREIGN KEY ("artwork_id") REFERENCES "artworks"("id")
          ON DELETE CASCADE ON UPDATE CASCADE,

        -- admin_id nullable (AI auto-moderation khÃ´ng cÃ³ admin)
        -- SET NULL khi admin bá»‹ xÃ³a Ä‘á»ƒ giá»¯ láº¡i audit trail
        CONSTRAINT "FK_moderation_admin_id"
          FOREIGN KEY ("admin_id") REFERENCES "users"("id")
          ON DELETE SET NULL ON UPDATE CASCADE,

        CONSTRAINT "CHK_moderation_score"
          CHECK ("ai_confidence_score" >= 0 AND "ai_confidence_score" <= 100),
        CONSTRAINT "CHK_moderation_action"
          CHECK ("action_taken" IN ('APPROVED', 'REJECTED', 'FLAGGED', 'MANUAL_REVIEW'))
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_moderation_artwork_id"
      ON "moderation_logs" ("artwork_id")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_moderation_admin_id"
      ON "moderation_logs" ("admin_id")
      WHERE "admin_id" IS NOT NULL
    `);

    // Index cho query "táº¥t cáº£ artwork bá»‹ REJECTED cÃ³ score cao" â†’ dashboard admin
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_moderation_action_score"
      ON "moderation_logs" ("action_taken", "ai_confidence_score" DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_moderation_action_score"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_moderation_admin_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_moderation_artwork_id"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "moderation_logs"`);
  }
}
