import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggerMiddleware, CorrelationIdMiddleware } from './app.middleware';

import { envValidationSchema } from './config/env.validation';

// ── Shared Infrastructure (@Global — raw clients, auto-DDL) ──────────────────
import { InfraRedisModule }         from './shared/redis/redis-client.module';
import { InfraClickHouseModule }    from './shared/clickhouse/clickhouse-client.module';

// ── Shared Services (@Global — business-level service wrappers) ──────────────
import { DatabaseModule }           from './database/database.module';
import { RedisModule }              from './shared/redis/redis.module';
import { ClickHouseModule }         from './shared/clickhouse/clickhouse.module';

// ── Auth ──────────────────────────────────────────────────────────────────────
import { AuthModule }               from './modules/auth/auth.module';

// ── Feature Modules ───────────────────────────────────────────────────────────
import { UsersModule }              from './modules/users/users.module';
import { ArtworksModule }           from './modules/artworks/artworks.module';
import { PortfolioModule }          from './modules/portfolio/portfolio.module';
import { TradesModule }             from './modules/trades/trades.module';

// ── Real-time Gateway ─────────────────────────────────────────────────────────
import { GatewayModule }            from './modules/gateway/gateway.module';

// ── Social ────────────────────────────────────────────────────────────────────
import { SocialModule }             from './modules/social/social.module';

// ── Moderation ────────────────────────────────────────────────────────────────
import { ModerationModule }         from './modules/moderation/moderation.module';

// ── Health ────────────────────────────────────────────────────────────────────
import { HealthModule }             from './modules/health/health.module';

// ── Blockchain Pipeline (@Global — merged indexer + consumer) ─────────────────
import { BlockchainModule }         from './modules/blockchain/blockchain.module';

// ─────────────────────────────────────────────────────────────────────────────
//  AppModule — Thứ tự import quan trọng:
//
//  1.  ConfigModule           — isGlobal, load trước tất cả
//  2.  InfraRedisModule       — @Global, INFRA_REDIS_CLIENT (raw ioredis)
//  3.  InfraClickHouseModule  — @Global, raw CH client + schema DDL (auto-run)
//  4.  DatabaseModule         — TypeORM/PostgreSQL
//  5.  RedisModule            — @Global, RedisService (pub/sub, cache, nonce, blacklist)
//  6.  ClickHouseModule       — @Global, ClickHouseService + ClickHouseBufferService
//  7.  AuthModule             — JWT + SIWE — PHẢI trước business modules
//  8.  ArtworksModule         — CRUD artworks, IPFS upload
//  9.  PortfolioModule        — user holdings, P&L
//  10. TradesModule           — OHLCV, trade history, leaderboard
//  11. GatewayModule          — WebSocket real-time prices
//  12. BlockchainModule       — @Global, full pipeline:
//                               viem watcher → RabbitMQ → event processor → PG + Redis + CH
// ─────────────────────────────────────────────────────────────────────────────

@Module({
  imports: [
    // ① Config
    ConfigModule.forRoot({
      isGlobal:         true,
      validationSchema: envValidationSchema,
      validationOptions: {
        abortEarly:  false,   // report all env errors at once
        allowUnknown: true,   // allow OS/CI env vars not in schema
      },
    }),

    // ② Shared Infrastructure
    InfraRedisModule,          // INFRA_REDIS_CLIENT  — ioredis raw client
    InfraClickHouseModule,     // INFRA_CLICKHOUSE_CLIENT + ClickHouseSchemaService

    // ③ Persistence + Service Layer
    DatabaseModule,            // TypeORM + PostgreSQL
    RedisModule,               // RedisService — pub/sub, cache, nonce, JWT blacklist
    ClickHouseModule,          // ClickHouseService + ClickHouseBufferService

    // ④ Auth
    AuthModule,

    // ⑤ Feature Modules
    UsersModule,
    ArtworksModule,
    PortfolioModule,
    TradesModule,

    // ⑥ Real-time
    GatewayModule,

    // ⑦ Social + Moderation
    SocialModule,
    ModerationModule,

    // ⑧ Health checks
    HealthModule,

    // ⑨ Blockchain Pipeline (merged indexer + consumer)
    BlockchainModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(CorrelationIdMiddleware, LoggerMiddleware)
      .forRoutes('*')   // apply to all routes
  }
}
