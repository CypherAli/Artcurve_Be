import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMissingIndexes1715000017000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
      ON notifications (user_id, is_read)
      WHERE is_read = false
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_notifications_created_at
      ON notifications (created_at DESC)
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_followers_compound
      ON followers (follower_id, following_id)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_live_streams_is_live_viewers
      ON live_streams (is_live, viewer_count DESC)
      WHERE is_live = true
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS idx_notifications_user_unread');
    await queryRunner.query('DROP INDEX IF EXISTS idx_notifications_created_at');
    await queryRunner.query('DROP INDEX IF EXISTS idx_followers_compound');
    await queryRunner.query('DROP INDEX IF EXISTS idx_live_streams_is_live_viewers');
  }
}
