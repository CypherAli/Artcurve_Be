import { MigrationInterface, QueryRunner } from 'typeorm';

// Index hỗ trợ keyset (cursor) pagination — để WHERE (sort_key, id) < (...) +
// ORDER BY sort_key DESC, id DESC chạy index-only, O(limit) ở mọi độ sâu.
export class AddKeysetIndexes1718390000000 implements MigrationInterface {
  name = 'AddKeysetIndexes1718390000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Marketplace infinite scroll: chỉ ACTIVE, mới nhất trước
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_artworks_active_created_id
      ON artworks (created_at DESC, id DESC)
      WHERE status = 'ACTIVE'
    `);

    // Lịch sử giao dịch của user theo thời gian (vault + trades me/history)
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_transactions_user_ts_id
      ON transactions (user_id, timestamp DESC, id DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_transactions_user_ts_id`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_artworks_active_created_id`);
  }
}
