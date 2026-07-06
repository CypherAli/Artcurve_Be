import { MigrationInterface, QueryRunner, TableColumn, TableIndex } from 'typeorm';

/**
 * Discovery layer: lưu vân tay + embedding + auto-tag cho mỗi artwork.
 *
 * Cố ý dùng jsonb cho embedding (mảng số) thay vì pgvector — ở quy mô sàn này
 * (vài nghìn tranh) brute-force cosine ở tầng app là tức thì, không cần cài
 * extension. Khi >100k tranh, đổi kiểu cột jsonb → vector là 1 migration.
 *
 * Tất cả cột NULLABLE — additive, không đụng data hiện có, có down() đảo ngược.
 */
export class AddDiscoveryFields1760000000000 implements MigrationInterface {
  name = 'AddDiscoveryFields1760000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumns('artworks', [
      // Vân tay dup-guard
      new TableColumn({ name: 'phash',       type: 'varchar', length: '64', isNullable: true }),
      new TableColumn({ name: 'embedding',   type: 'jsonb',                  isNullable: true }),
      // Auto-tag
      new TableColumn({ name: 'style_tags',  type: 'jsonb',                  isNullable: true }),
      new TableColumn({ name: 'mood',        type: 'varchar', length: '30',  isNullable: true }),
      new TableColumn({ name: 'palette',     type: 'jsonb',                  isNullable: true }),
    ]);

    await queryRunner.createIndex('artworks', new TableIndex({
      name: 'idx_artworks_phash',
      columnNames: ['phash'],
    }));
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex('artworks', 'idx_artworks_phash');
    await queryRunner.dropColumns('artworks', ['phash', 'embedding', 'style_tags', 'mood', 'palette']);
  }
}
