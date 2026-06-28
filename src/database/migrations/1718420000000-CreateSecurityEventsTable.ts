import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class CreateSecurityEventsTable1718420000000 implements MigrationInterface {
  name = 'CreateSecurityEventsTable1718420000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'security_events',
        columns: [
          { name: 'id',             type: 'uuid',        isPrimary: true, generationStrategy: 'uuid', default: 'uuid_generate_v4()' },
          { name: 'event_type',     type: 'varchar',     length: '50',   isNullable: false },
          { name: 'wallet_address', type: 'varchar',     length: '42',   isNullable: true },
          { name: 'ip_address',     type: 'varchar',     length: '45',   isNullable: false },
          { name: 'user_agent',     type: 'varchar',     length: '500',  isNullable: true },
          { name: 'metadata',       type: 'jsonb',                       isNullable: true },
          { name: 'severity',       type: 'varchar',     length: '20',   isNullable: false, default: "'INFO'" },
          { name: 'created_at',     type: 'timestamptz',                 isNullable: false, default: 'now()' },
        ],
      }),
      true,
    );

    await queryRunner.createIndex('security_events', new TableIndex({
      name:        'idx_security_event_type',
      columnNames: ['event_type'],
    }));
    await queryRunner.createIndex('security_events', new TableIndex({
      name:        'idx_security_wallet_address',
      columnNames: ['wallet_address'],
    }));
    await queryRunner.createIndex('security_events', new TableIndex({
      name:        'idx_security_ip_address',
      columnNames: ['ip_address'],
    }));
    await queryRunner.createIndex('security_events', new TableIndex({
      name:        'idx_security_created_at',
      columnNames: ['created_at'],
    }));
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('security_events', true);
  }
}
