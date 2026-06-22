import 'reflect-metadata'
import { NestFactory }             from '@nestjs/core'
import { ValidationPipe, Logger }  from '@nestjs/common'
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger'
import { ConfigService }           from '@nestjs/config'
import helmet                      from 'helmet'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const compression = require('compression')
import { AppModule }               from './app.module'
import { AllExceptionsFilter }     from './common/filters/all-exceptions.filter'
import { TransformInterceptor }    from './common/interceptors/transform.interceptor'
import { initSentry, closeSentry } from './common/observability/sentry.util'
import { RedisIoAdapter }          from './common/adapters/redis-io.adapter'
import { JsonLogger }              from './common/observability/json-logger'

async function bootstrap() {
  const logger = new Logger('Bootstrap')

  // Init Sentry SỚM — bắt cả lỗi trong quá trình khởi động
  initSentry(process.env.SENTRY_DSN, process.env.NODE_ENV ?? 'development')

  // rawBody: true — cần để verify LiveKit webhook signature (HMAC trên raw bytes)
  const app    = await NestFactory.create(AppModule, { bufferLogs: true, rawBody: true })
  const config = app.get(ConfigService)

  const isProd = config.get('NODE_ENV') === 'production'

  // Production: structured JSON logging cho log aggregator
  if (isProd) app.useLogger(new JsonLogger())

  // ── Security headers (Helmet) ────────────────────────────────────
  app.use(
    helmet({
      // Dev: tắt CSP để Swagger UI (inline scripts) hoạt động
      // Prod: định nghĩa rõ ràng — không dùng undefined/default
      contentSecurityPolicy: isProd
        ? {
            directives: {
              'default-src':     ["'self'"],
              'script-src':      ["'self'"],
              'style-src':       ["'self'", 'https:'],
              'img-src':         ["'self'", 'data:', 'https:'],
              'font-src':        ["'self'", 'https:'],
              'connect-src':     ["'self'", 'https:', 'wss:'],
              'frame-ancestors': ["'none'"],
              'base-uri':        ["'self'"],
              'form-action':     ["'self'"],
              'object-src':      ["'none'"],
              'upgrade-insecure-requests': [],
            },
          }
        : false,
      crossOriginEmbedderPolicy: isProd,
      crossOriginOpenerPolicy:   isProd ? { policy: 'same-origin' } : false,
    }),
  )
  app.use(compression())

  // ── CORS ──────────────────────────────────────────────────────────
  const rawOrigins = (
    config.get<string>('CORS_ORIGINS') ??
    config.get<string>('FRONTEND_URL') ??
    'http://localhost:3000'
  )
  const allowedOrigins = rawOrigins
    .split(',')
    .map((s: string) => s.trim())
    .filter(Boolean)

  if (!allowedOrigins.length) {
    throw new Error('CORS_ORIGINS or FRONTEND_URL must be configured')
  }

  // Production: từ chối non-HTTPS origin — tránh session hijack qua plaintext
  if (isProd) {
    const insecure = allowedOrigins.filter(o => !o.startsWith('https://'))
    if (insecure.length) {
      throw new Error(`Non-HTTPS CORS origins rejected in production: ${insecure.join(', ')}`)
    }
  }

  app.enableCors({
    origin:         allowedOrigins,
    credentials:    true,
    methods:        ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Correlation-ID'],
    exposedHeaders: ['X-Correlation-ID'],
    maxAge:         3600,   // cache preflight 1 giờ
  })

  // ── Global middleware ─────────────────────────────────────────────
  app.setGlobalPrefix('api/v1')
  app.useGlobalPipes(new ValidationPipe({
    whitelist:            true,    // strip unknown fields
    forbidNonWhitelisted: true,    // 400 on unknown fields
    transform:            true,    // auto-cast query params
    transformOptions: { enableImplicitConversion: true },
  }))
  app.useGlobalFilters(new AllExceptionsFilter())
  app.useGlobalInterceptors(new TransformInterceptor())
  app.enableShutdownHooks()

  // ── WebSocket horizontal scaling (Redis adapter) ──────────────────
  // Có REDIS_URL → broadcast WS cross-instance; không có → adapter in-memory (1 instance).
  const redisUrl = config.get<string>('REDIS_URL')
  if (redisUrl) {
    try {
      const redisIoAdapter = new RedisIoAdapter(app)
      await redisIoAdapter.connectToRedis(redisUrl)
      app.useWebSocketAdapter(redisIoAdapter)
    } catch (e) {
      logger.warn(`Redis IO adapter skipped (fallback single-instance): ${(e as Error).message}`)
    }
  }

  // ── Swagger ───────────────────────────────────────────────────────
  if (config.get('NODE_ENV') !== 'production') {
    const doc = new DocumentBuilder()
      .setTitle('ArtCurve API')
      .setDescription(
        '## Fractionalized Art Trading DApp — Web3 Bonding Curve on Base\n\n' +
        '### Auth Flow (SIWE — EIP-4361)\n' +
        '1. `POST /api/v1/auth/nonce` — Lấy SIWE message chuẩn EIP-4361\n' +
        '2. Ký bằng MetaMask: `personal_sign(message, wallet)`\n' +
        '3. `POST /api/v1/auth/verify` — Gửi { wallet_address, signature, message } → nhận JWT\n' +
        '4. Gắn `Authorization: Bearer <token>` vào mọi request tiếp theo\n\n' +
        '### Response Format\n' +
        '- Success: `{ "data": { ... } }`\n' +
        '- Error:   `{ "statusCode": 4xx, "timestamp": "...", "path": "...", "message": "..." }`',
      )
      .setVersion('1.0')
      .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'JWT-auth')
      .addTag('Auth — Web3 Sign-In', 'SIWE (EIP-4361) authentication')
      .addTag('Users', 'User profiles and top creators')
      .addTag('Artworks', 'Artwork CRUD, IPFS upload, status machine')
      .addTag('Trades', 'OHLCV candles, trade history, leaderboard')
      .addTag('Portfolio', 'Holdings, P&L, top holders')
      .addTag('Social', 'Follow/unfollow users, like artworks')
      .addTag('Moderation', 'AI content moderation for artworks')
      .addTag('Health', 'Service health checks')
      .build()
    const document = SwaggerModule.createDocument(app, doc)
    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: {
        persistAuthorization: true,
        tagsSorter:           'alpha',
        operationsSorter:     'alpha',
      },
    })
    logger.log(`Swagger UI: http://localhost:${config.get('PORT') ?? 3001}/api/docs`)
  }

  // Global error handlers — catch async errors outside HTTP context
  process.on('unhandledRejection', (reason) => {
    logger.error(`Unhandled Rejection: ${reason}`)
  })
  process.on('uncaughtException', (err) => {
    logger.error(`Uncaught Exception: ${err.message}`, err.stack)
    void closeSentry(2000).then(() => process.exit(1))
  })

  // Graceful shutdown — drain in-flight requests before closing
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
      logger.log(`Received ${signal} — draining connections (5s)`)
      void (async () => {
        await new Promise(r => setTimeout(r, 5000))
        await app.close()
        await closeSentry(2000)
        process.exit(0)
      })()
    })
  }

  const port = config.get<number>('PORT') ?? 3001
  await app.listen(port)
  logger.log(`ArtCurve API running on http://localhost:${port}/api/v1`)
  logger.log(`WebSocket /events : ws://localhost:${port}/events  (JWT required)`)
  logger.log(`WebSocket /prices : ws://localhost:${port}/prices  (no auth)`)
  logger.log(`Environment       : ${config.get('NODE_ENV') ?? 'development'}`)
}
bootstrap()
