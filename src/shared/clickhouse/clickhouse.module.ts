import { Module, Global, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, ClickHouseClient } from '@clickhouse/client';
import { ClickHouseService } from './clickhouse.service';
import { ClickHouseBufferService } from './clickhouse-buffer.service';
import { CLICKHOUSE_CLIENT } from './clickhouse.constants';

@Global()
@Module({
  providers: [
    {
      provide: CLICKHOUSE_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService): ClickHouseClient => {
        return createClient({
          // CLICKHOUSE_HOST trong .env đã LÀ URL đầy đủ (vd http://localhost:8123
          // hoặc https://xxx.clickhouse.cloud:8443) — KHÔNG được ghép thêm
          // protocol/port thủ công, nếu không ra URL hỏng dạng
          // "http://http://localhost:8123:8123" khiến mọi query OHLCV lỗi 500.
          url:      config.get('CLICKHOUSE_HOST', 'http://localhost:8123'),
          username: config.get('CLICKHOUSE_USER', 'artcurve'),
          password: config.get('CLICKHOUSE_PASSWORD', 'artcurve_ch_pass'),
          database: config.get('CLICKHOUSE_DB', 'artcurve_analytics'),
          // Rule: batch insert — clickhouse_settings toi uu throughput
          clickhouse_settings: {
            async_insert:          1,
            wait_for_async_insert: 0,  // fire-and-forget cho toc do cao
          },
          compression: { request: false, response: true },
        });
      },
    },
    ClickHouseService,
    ClickHouseBufferService,  // Buffer gom trade truoc khi flush batch
  ],
  exports: [ClickHouseService, ClickHouseBufferService, CLICKHOUSE_CLIENT],
})
export class ClickHouseModule implements OnApplicationShutdown {
  constructor() {}
  async onApplicationShutdown() {}
}
