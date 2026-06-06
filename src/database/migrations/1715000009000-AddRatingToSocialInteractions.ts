import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRatingToSocialInteractions1715000009000 implements MigrationInterface {
  public name = 'AddRatingToSocialInteractions1715000009000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "social_interactions"
        ADD COLUMN IF NOT EXISTS "rating" SMALLINT
          CHECK ("rating" IS NULL OR ("rating" >= 1 AND "rating" <= 5))
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_social_artwork_rating"
        ON "social_interactions" ("artwork_id", "rating")
        WHERE "interaction_type" = 'COMMENT'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_social_artwork_rating"`);
    await queryRunner.query(`ALTER TABLE "social_interactions" DROP COLUMN IF EXISTS "rating"`);
  }
}
