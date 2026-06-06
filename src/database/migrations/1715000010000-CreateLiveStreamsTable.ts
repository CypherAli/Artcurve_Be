import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class CreateLiveStreamsTable1715000010000 implements MigrationInterface {
  name = 'CreateLiveStreamsTable1715000010000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'live_streams',
        columns: [
          { name: 'id',            type: 'uuid',        isPrimary: true, generationStrategy: 'uuid', default: 'uuid_generate_v4()' },
          { name: 'room_name',     type: 'varchar',     length: '128',  isUnique: true, isNullable: false },
          { name: 'title',         type: 'varchar',     length: '255',  isNullable: false },
          { name: 'category',      type: 'varchar',     length: '64',   isNullable: false, default: "'Painting'" },
          { name: 'host_id',       type: 'varchar',     length: '255',  isNullable: false },
          { name: 'host_name',     type: 'varchar',     length: '128',  isNullable: false },
          { name: 'viewer_count',  type: 'int',                         isNullable: false, default: 0 },
          { name: 'is_live',       type: 'boolean',                     isNullable: false, default: true },
          { name: 'artwork_ticker',type: 'varchar',     length: '32',   isNullable: true },
          { name: 'started_at',    type: 'timestamptz',                 isNullable: false, default: 'now()' },
          { name: 'ended_at',      type: 'timestamptz',                 isNullable: true },
          { name: 'updated_at',    type: 'timestamptz',                 isNullable: false, default: 'now()' },
        ],
      }),
      true,
    );

    await queryRunner.createIndex('live_streams', new TableIndex({
      name:        'idx_live_is_live',
      columnNames: ['is_live'],
    }));
    await queryRunner.createIndex('live_streams', new TableIndex({
      name:        'idx_live_host',
      columnNames: ['host_id'],
    }));
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('live_streams', true);
  }
}
