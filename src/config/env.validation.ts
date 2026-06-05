import * as Joi from 'joi';

// ─────────────────────────────────────────────────────────────────────────────
//  env.validation.ts
//
//  Joi schema để validate biến môi trường khi NestJS khởi động.
//  Sử dụng trong ConfigModule.forRoot({ validationSchema }).
//
//  Quy tắc:
//    - required(): bắt buộc phải có — app sẽ CRASH nếu thiếu
//    - optional() / default(): có thể không có — dùng default value
//    - Tất cả PORT parse ra number; boolean parse từ string 'true'/'false'
//
//  Nhóm biến:
//    [1] App        — NODE_ENV, PORT, APP_DOMAIN
//    [2] Auth       — JWT_SECRET, JWT_EXPIRES_IN, SIWE_CHAIN_ID
//    [3] CORS       — CORS_ORIGINS
//    [4] PostgreSQL — DATABASE_URL (hoặc từng biến riêng)
//    [5] Redis      — REDIS_URL (infrastructure layer)
//    [6] ClickHouse — CLICKHOUSE_* (infrastructure layer)
//    [7] RabbitMQ   — RABBITMQ_URL
//    [8] Blockchain — RPC_URL, CHAIN_ID, ART_FACTORY_ADDRESS
// ─────────────────────────────────────────────────────────────────────────────

export const envValidationSchema = Joi.object({
  // ── [1] App ────────────────────────────────────────────────────────────────
  NODE_ENV:   Joi.string().valid('development', 'production', 'test').default('development'),
  PORT:       Joi.number().integer().min(1).max(65535).default(3000),
  APP_DOMAIN: Joi.string().hostname().default('artcurve.io'),

  // ── [2] Auth ───────────────────────────────────────────────────────────────
  JWT_SECRET:     Joi.string().min(32).required(),
  JWT_EXPIRES_IN: Joi.string().default('7d'),
  SIWE_CHAIN_ID:  Joi.number().integer().positive().default(8453),  // Base mainnet

  // ── [3] CORS ───────────────────────────────────────────────────────────────
  // Comma-separated list of allowed origins, e.g. "https://artcurve.io,https://www.artcurve.io"
  CORS_ORIGINS: Joi.string().default('http://localhost:3000'),

  // ── [4] PostgreSQL ─────────────────────────────────────────────────────────
  DATABASE_URL: Joi.string().uri({ scheme: ['postgresql', 'postgres'] }).required(),

  // ── [5] Redis (Infrastructure Layer) ───────────────────────────────────────
  REDIS_URL: Joi.string().default('redis://localhost:6379'),

  // ── [6] ClickHouse (Infrastructure Layer) ──────────────────────────────────
  CLICKHOUSE_HOST:            Joi.string().uri().default('http://localhost:8123'),
  CLICKHOUSE_DB:              Joi.string().default('artcurve_analytics'),
  CLICKHOUSE_USER:            Joi.string().default('artcurve'),
  CLICKHOUSE_PASSWORD:        Joi.string().allow('').default(''),
  CLICKHOUSE_REQUEST_TIMEOUT: Joi.number().integer().positive().default(30_000),

  // ── [7] RabbitMQ ───────────────────────────────────────────────────────────
  RABBITMQ_URL: Joi.string().default('amqp://localhost:5672'),

  // Routing keys & queue names (override defaults for multi-tenant setups)
  ARTWORK_CREATED_ROUTING_KEY: Joi.string().default('blockchain.artwork.created'),
  TRADE_EXECUTED_ROUTING_KEY:  Joi.string().default('blockchain.trade.executed'),
  GRADUATED_ROUTING_KEY:       Joi.string().default('blockchain.graduated'),
  ARTWORK_CREATED_QUEUE:       Joi.string().default('artcurve.artwork.created'),
  TRADE_EXECUTED_QUEUE:        Joi.string().default('artcurve.trade.executed'),
  GRADUATED_QUEUE:             Joi.string().default('artcurve.tx.graduated'),

  // ── [8] Blockchain / Indexer ───────────────────────────────────────────────
  RPC_URL:             Joi.string().uri({ scheme: ['http', 'https', 'wss', 'ws'] }).default('https://mainnet.base.org'),
  CHAIN_ID:            Joi.number().integer().positive().default(8453),
  // ART_FACTORY_ADDRESS — optional; watcher disables gracefully if not set
  ART_FACTORY_ADDRESS: Joi.string()
    .pattern(/^0x[0-9a-fA-F]{40}$/)
    .default('0x0000000000000000000000000000000000000000'),
});
