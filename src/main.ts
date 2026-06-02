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

async function bootstrap() {
  const logger = new Logger('Bootstrap')
  const app    = await NestFactory.create(AppModule, { bufferLogs: true })
  const config = app.get(ConfigService)

  // ── Security ──────────────────────────────────────────────────────
  app.use(
    helmet({
      // CSP cần tuỳ chỉnh nếu có Swagger UI (inline scripts)
      contentSecurityPolicy: config.get('NODE_ENV') === 'production'
        ? undefined  // strict CSP trên production
        : false,     // tắt CSP trên dev để Swagger UI hoạt động
    }),
  )
  app.use(compression())

  // ── CORS ──────────────────────────────────────────────────────────
  const allowedOrigins = (config.get<string>('CORS_ORIGINS') ?? config.get<string>('FRONTEND_URL') ?? 'http://localhost:3000')
    .split(',')
    .map((s: string) => s.trim())
  app.enableCors({
    origin:         allowedOrigins,
    credentials:    true,
    methods:        ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
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

  const port = config.get<number>('PORT') ?? 3001
  await app.listen(port)
  logger.log(`ArtCurve API running on http://localhost:${port}/api/v1`)
  logger.log(`WebSocket /events : ws://localhost:${port}/events  (JWT required)`)
  logger.log(`WebSocket /prices : ws://localhost:${port}/prices  (no auth)`)
  logger.log(`Environment       : ${config.get('NODE_ENV') ?? 'development'}`)
}
bootstrap()
