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
//    [1]  App          — NODE_ENV, PORT, APP_DOMAIN, APP_URI, FRONTEND_URL
//    [2]  Auth         — JWT_SECRET, JWT_EXPIRES_IN, SIWE_CHAIN_ID
//    [3]  CORS         — CORS_ORIGINS
//    [4]  PostgreSQL   — DATABASE_URL
//    [5]  Redis        — REDIS_URL
//    [6]  ClickHouse   — CLICKHOUSE_*
//    [7]  RabbitMQ     — RABBITMQ_URL, routing keys & queues
//    [8]  Blockchain   — RPC_URL, WS_RPC_URL, CHAIN_ID, contract addresses
//    [9]  OAuth        — GITHUB_*, TWITTER_*, TELEGRAM_BOT_TOKEN
//    [10] IPFS/Pinata  — PINATA_*
//    [11] AI Moderation — OPENAI_API_KEY (optional)
//    [12] Internal     — INTERNAL_SERVICE_KEY
// ─────────────────────────────────────────────────────────────────────────────

const address = () =>
  Joi.string()
    .pattern(/^0x[0-9a-fA-F]{40}$/)
    .default('0x0000000000000000000000000000000000000000');

export const envValidationSchema = Joi.object({
  // ── [1] App ────────────────────────────────────────────────────────────────
  NODE_ENV:     Joi.string().valid('development', 'production', 'test').default('development'),
  PORT:         Joi.number().integer().min(1).max(65535).default(3001),
  APP_DOMAIN:   Joi.string().default('artcurve.io'),
  // APP_URI: URL gốc của backend — dùng trong OAuth callback redirect
  APP_URI:      Joi.string().uri().default('http://localhost:3001'),
  // FRONTEND_URL: URL frontend — dùng để redirect sau OAuth và CORS
  FRONTEND_URL: Joi.string().uri().default('http://localhost:3000'),

  // ── [2] Auth ───────────────────────────────────────────────────────────────
  JWT_SECRET:     Joi.string().min(32).required(),
  JWT_EXPIRES_IN: Joi.string().default('7d'),
  SIWE_CHAIN_ID:  Joi.number().integer().positive().default(8453),  // Base mainnet

  // ── [3] CORS ───────────────────────────────────────────────────────────────
  CORS_ORIGINS: Joi.string().default('http://localhost:3000'),

  // ── [4] PostgreSQL ─────────────────────────────────────────────────────────
  DATABASE_URL: Joi.string().uri({ scheme: ['postgresql', 'postgres'] }).required(),

  // ── [5] Redis ──────────────────────────────────────────────────────────────
  REDIS_URL: Joi.string().default('redis://localhost:6379'),

  // ── [6] ClickHouse ─────────────────────────────────────────────────────────
  CLICKHOUSE_HOST:            Joi.string().uri().default('http://localhost:8123'),
  CLICKHOUSE_DB:              Joi.string().default('artcurve_analytics'),
  CLICKHOUSE_USER:            Joi.string().default('artcurve'),
  CLICKHOUSE_PASSWORD:        Joi.string().allow('').default(''),
  CLICKHOUSE_REQUEST_TIMEOUT: Joi.number().integer().positive().default(30_000),

  // ── [7] RabbitMQ ───────────────────────────────────────────────────────────
  RABBITMQ_URL: Joi.string().default('amqp://localhost:5672'),

  ARTWORK_CREATED_ROUTING_KEY: Joi.string().default('blockchain.artwork.created'),
  TRADE_EXECUTED_ROUTING_KEY:  Joi.string().default('blockchain.trade.executed'),
  GRADUATED_ROUTING_KEY:       Joi.string().default('blockchain.graduated'),
  ARTWORK_CREATED_QUEUE:       Joi.string().default('artcurve.artwork.created'),
  TRADE_EXECUTED_QUEUE:        Joi.string().default('artcurve.trade.executed'),
  GRADUATED_QUEUE:             Joi.string().default('artcurve.tx.graduated'),

  // ── [8] Blockchain / Indexer ───────────────────────────────────────────────
  RPC_URL:    Joi.string().uri({ scheme: ['http', 'https'] }).default('https://mainnet.base.org'),
  // WS_RPC_URL: WebSocket RPC cho event watcher — fallback về RPC_URL nếu không set
  WS_RPC_URL: Joi.string().uri({ scheme: ['wss', 'ws', 'http', 'https'] }).default('wss://mainnet.base.org'),
  CHAIN_ID:   Joi.number().integer().positive().default(8453),

  // ART_FACTORY_ADDRESS: địa chỉ contract chính (indexer sẽ watch address này)
  ART_FACTORY_ADDRESS:            address(),
  BONDING_CURVE_ADDRESS:          address(),
  CONTRACT_ART_FACTORY_SEPOLIA:   address(),
  CONTRACT_BONDING_CURVE_SEPOLIA: address(),
  CONTRACT_ART_FACTORY_BASE:      address(),
  CONTRACT_BONDING_CURVE_BASE:    address(),

  INDEXER_START_BLOCK: Joi.number().integer().min(0).default(0),

  // ── [9] OAuth ──────────────────────────────────────────────────────────────
  // GitHub OAuth 2.0
  // Lấy tại: https://github.com/settings/applications/new
  GITHUB_CLIENT_ID:     Joi.string().allow('').default(''),
  GITHUB_CLIENT_SECRET: Joi.string().allow('').default(''),

  // Twitter / X OAuth 1.0a
  // Lấy tại: https://developer.twitter.com/en/portal/projects-and-apps
  TWITTER_CONSUMER_KEY:    Joi.string().allow('').default(''),
  TWITTER_CONSUMER_SECRET: Joi.string().allow('').default(''),

  // Telegram Bot Token
  // Lấy qua @BotFather trên Telegram
  TELEGRAM_BOT_TOKEN: Joi.string().allow('').default(''),

  // Google OAuth 2.0 (chưa implement — placeholder cho tương lai)
  GOOGLE_CLIENT_ID:     Joi.string().allow('').default(''),
  GOOGLE_CLIENT_SECRET: Joi.string().allow('').default(''),
  GOOGLE_CALLBACK_URL:  Joi.string().uri().allow('').default(''),

  // ── [10] IPFS / Pinata ─────────────────────────────────────────────────────
  // Lấy tại: https://app.pinata.cloud/keys
  // Bắt buộc ở production để upload artwork lên IPFS
  PINATA_API_KEY:    Joi.string().allow('').default(''),
  PINATA_SECRET_KEY: Joi.string().allow('').default(''),
  PINATA_JWT:        Joi.string().allow('').default(''),
  PINATA_GATEWAY:    Joi.string().uri().default('https://gateway.pinata.cloud'),
  IPFS_GATEWAY:      Joi.string().uri().default('https://gateway.pinata.cloud/ipfs'),

  // ── [11] AI Moderation ─────────────────────────────────────────────────────
  // Optional — nếu không set thì artwork tự động approved (dev mode)
  OPENAI_API_KEY:       Joi.string().allow('').default(''),
  // Artcurve_AI service (detect / embed / tag / similarity) — discovery layer
  AI_SERVICE_URL:       Joi.string().uri().default('http://localhost:8000'),
  GOOGLE_VISION_API_KEY: Joi.string().allow('').default(''),
  NSFW_SCORE_THRESHOLD: Joi.number().min(0).max(1).default(0.7),

  // ── [15] AI Chat (Gemini) ─────────────────────────────────────────────────
  GEMINI_API_KEY: Joi.string().allow('').default(''),

  // ── [16] Observability ─────────────────────────────────────────────────────
  // Optional — không set thì Sentry tắt (app vẫn chạy bình thường)
  SENTRY_DSN: Joi.string().allow('').default(''),

  // ── [16] Escalation ───────────────────────────────────────────────────────
  SMTP_HOST: Joi.string().allow('').default(''),
  SMTP_PORT: Joi.number().integer().default(587),
  SMTP_USER: Joi.string().allow('').default(''),
  SMTP_PASS: Joi.string().allow('').default(''),
  ESCALATION_EMAIL: Joi.string().allow('').default(''),
  TELEGRAM_ESCALATION_CHAT_ID: Joi.string().allow('').default(''),

  // ── [12] Internal Security ─────────────────────────────────────────────────
  INTERNAL_SERVICE_KEY: Joi.string().allow('').default('change_me_to_random_secret'),

  // ── [13] Curve Engine gRPC ────────────────────────────────────────────────
  // host:port of Rust Curve Engine gRPC service (default local dev)
  CURVE_ENGINE_URL: Joi.string().default('localhost:50051'),

  // ── [14] LiveKit — Real-time streaming ────────────────────────────────────
  // Lấy tại: https://cloud.livekit.io → Settings → API Keys
  LIVEKIT_API_KEY:    Joi.string().allow('').default(''),
  LIVEKIT_API_SECRET: Joi.string().allow('').default(''),
  // wss://your-project.livekit.cloud
  LIVEKIT_URL:        Joi.string().allow('').default(''),
});
