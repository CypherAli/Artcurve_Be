import { MigrationInterface, QueryRunner } from 'typeorm';

// Migration 009 — Xóa cột nonce khỏi bảng users
// Lý do: AuthService đã chuyển sang lưu nonce trong Redis (TTL 5 phút)
// thay vì DB, giúp giảm write lock và auto-expire không cần cleanup job.
export class RemoveUserNonce1715000008000 implements MigrationInterface {
  public name = 'RemoveUserNonce1715000008000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        DROP COLUMN IF EXISTS "nonce"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Khôi phục cột nonce nếu rollback cần thiết
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN IF NOT EXISTS "nonce" TEXT
    `);
  }
}
