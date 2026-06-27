import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { ConfigModule }   from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { LoggerMiddleware, CorrelationIdMiddleware } from './app.middleware';
import { MetricsModule }   from './modules/metrics/metrics.module';
import { MetricsInterceptor } from './common/interceptors/metrics.interceptor';

import { envValidationSchema } from './config/env.validation';

// ── Shared Infrastructure (@Global — raw clients, auto-DDL) ──────────────────
import { InfraRedisModule }         from './shared/redis/redis-client.module';
import { InfraClickHouseModule }    from './shared/clickhouse/clickhouse-client.module';
import { CurveEngineModule }        from './shared/curve-engine/curve-engine.module';
import { OnchainQuoteModule }       from './shared/onchain-quote/onchain-quote.module';

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
import { VaultModule }              from './modules/vault/vault.module';

// ── Real-time Gateway ─────────────────────────────────────────────────────────
import { GatewayModule }            from './modules/gateway/gateway.module';

// ── Social ────────────────────────────────────────────────────────────────────
import { SocialModule }             from './modules/social/social.module';

// ── Moderation ────────────────────────────────────────────────────────────────
import { ModerationModule }         from './modules/moderation/moderation.module';

// ── Health ────────────────────────────────────────────────────────────────────
import { HealthModule }             from './modules/health/health.module';

// ── Live Streaming ────────────────────────────────────────────────────────────
import { LiveModule }               from './modules/live/live.module';

// ── Notifications (@Global) ───────────────────────────────────────────────────
import { NotificationsModule }      from './modules/notifications/notifications.module';

// ── Guild ─────────────────────────────────────────────────────────────────────
import { GuildModule }              from './modules/guild/guild.module';

// ── AI Chat ───────────────────────────────────────────────────────────────────
import { ChatModule }               from './modules/chat/chat.module';

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

    // Rate limiting toàn cục — endpoint tự override bằng @Throttle()
    ThrottlerModule.forRoot([{
      ttl:   60_000,   // 1 phút window
      limit: 120,      // 120 req/phút default; auth endpoints override xuống thấp hơn
    }]),

    // ② Shared Infrastructure
    InfraRedisModule,          // INFRA_REDIS_CLIENT  — ioredis raw client
    InfraClickHouseModule,     // INFRA_CLICKHOUSE_CLIENT + ClickHouseSchemaService
    CurveEngineModule,         // @Global gRPC client → Rust Curve Engine :50051
    OnchainQuoteModule,        // @Global on-chain quote via RPC (matches actual execution price)

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
    VaultModule,

    // ⑥ Real-time
    GatewayModule,

    // ⑦ Notifications (@Global — trước Social để SocialModule có thể inject)
    NotificationsModule,

    // ⑧ Social + Moderation
    SocialModule,
    ModerationModule,

    // ⑧ Health checks + metrics
    HealthModule,
    MetricsModule,

    // ⑩ Live Streaming
    LiveModule,

    // ⑪ Guild
    GuildModule,

    // ⑫ AI Chat
    ChatModule,

    // ⑨ Blockchain Pipeline (merged indexer + consumer)
    BlockchainModule,
  ],
  providers: [
    // ThrottlerGuard áp dụng rate limit toàn cục; @SkipThrottle() để bypass ở endpoint cụ thể
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // Ghi Prometheus metrics cho mọi HTTP request
    { provide: APP_INTERCEPTOR, useClass: MetricsInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(CorrelationIdMiddleware, LoggerMiddleware)
      .forRoutes('*')   // apply to all routes
  }
}
