import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

// ─────────────────────────────────────────────────────────────────────────────
//  InfraRedisModule  (src/infrastructure/redis/)
//
//  Tầng Hạ tầng — cung cấp raw ioredis client cho toàn bộ app (@Global).
//
//  Phân biệt với src/modules/redis/ (RedisModule + RedisService cũ):
//    - RedisModule cũ: gắn liền với business logic (price cache, leaderboard,
//                      pub/sub cho PriceGateway, nonce, JWT blacklist)
//    - InfraRedisModule: infrastructure layer — cung cấp raw client để các
//                        module khác có thể inject nếu cần bypass RedisService
//
//  Trong production, cả hai module đều tồn tại song song.
//  RedisModule (cũ) @Global() vẫn là primary service cho business modules.
//
//  Config đọc từ .env:
//    REDIS_HOST     — default: localhost
//    REDIS_PORT     — default: 6379
//    REDIS_PASSWORD — optional
//    REDIS_DB       — default: 0
// ─────────────────────────────────────────────────────────────────────────────

export const INFRA_REDIS_CLIENT = 'INFRA_REDIS_CLIENT';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide:    INFRA_REDIS_CLIENT,
      inject:     [ConfigService],
      useFactory: (config: ConfigService): Redis => {
        const client = new Redis({
          host:         config.get('REDIS_HOST',     'localhost'),
          port:         config.get<number>('REDIS_PORT', 6379),
          password:     config.get('REDIS_PASSWORD', undefined),
          db:           config.get<number>('REDIS_DB', 0),
          maxRetriesPerRequest: null,
          enableReadyCheck: false,
          retryStrategy: (times: number) => Math.min(times * 500, 10_000),
          connectionName: 'artcurve-infra',
          lazyConnect: true,
        });

        // MUST attach error handler — otherwise Node throws on ECONNREFUSED
        client.on('error',        (e) => console.warn('[InfraRedis] error:', e.message));
        client.on('connect',       () => console.log('[InfraRedis] connected'));
        client.on('reconnecting',  () => console.warn('[InfraRedis] reconnecting…'));

        return client;
      },
    },
  ],
  exports: [INFRA_REDIS_CLIENT],
})
export class InfraRedisModule {}
