import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { createClient } from '@clickhouse/client';
import { InfraClickHouseService } from './clickhouse-infra.service';
import { ClickHouseSchemaService } from './schema.service';
import { INFRA_CLICKHOUSE_CLIENT } from './clickhouse.tokens';

// Re-export so existing imports like `from './clickhouse-client.module'` still work
export { INFRA_CLICKHOUSE_CLIENT } from './clickhouse.tokens';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide:  INFRA_CLICKHOUSE_CLIENT,
      inject:   [ConfigService],
      useFactory: (config: ConfigService) =>
        createClient({
          url:      config.get('CLICKHOUSE_HOST', 'http://localhost:8123'),
          database: config.get('CLICKHOUSE_DB',   'artcurve_analytics'),
          username: config.get('CLICKHOUSE_USER',  'artcurve'),
          password: config.get('CLICKHOUSE_PASSWORD', ''),
          clickhouse_settings: { async_insert: 1, wait_for_async_insert: 0 },
          request_timeout: config.get<number>('CLICKHOUSE_REQUEST_TIMEOUT', 30_000),
        }),
    },
    InfraClickHouseService,
    ClickHouseSchemaService,
  ],
  exports: [INFRA_CLICKHOUSE_CLIENT, InfraClickHouseService, ClickHouseSchemaService],
})
export class InfraClickHouseModule {}
