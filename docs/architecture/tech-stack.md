# Tech Stack

## Core Services

| Layer | Technology | Version | Purpose |
|-------|-----------|---------|---------|
| **Framework** | NestJS | 10.x | Modular REST API with dependency injection |
| **Language** | TypeScript | 5.x | Type-safe backend development |
| **Database** | PostgreSQL | 16 | Source of truth — users, artworks, transactions |
| **ORM** | TypeORM | latest | Entity mapping, migrations, query builder |
| **Cache / PubSub** | Redis | 7 | Nonce storage, JWT blacklist, price cache, Pub/Sub |
| **Analytics** | ClickHouse | 23+ | OHLCV candles via Materialized Views, high-write trade data |
| **Message Queue** | RabbitMQ | 3.12 | Blockchain event distribution, order matching |
| **Blockchain** | viem | latest | Base L2 contract interaction, event watching |
| **WebSocket** | Socket.IO | latest | Real-time price updates (NestJS gateway) |
| **Live Streaming** | LiveKit Cloud SDK | latest | Room management, viewer tokens |
| **IPFS** | Pinata | latest | Artwork file and metadata pinning |
| **Smart Contracts** | Solidity + Foundry | 0.8.x | ArtFactory, BondingCurveAMM, ArtFractionToken |

## Authentication

| Component | Technology | Details |
|-----------|-----------|---------|
| **Web3 Auth** | SIWE (EIP-4361) | Sign-In With Ethereum, nonce-based replay protection |
| **Token** | JWT (RS256) | 15min access + 30-day refresh, rotation, Redis blacklist |
| **OAuth** | Passport.js | GitHub, Google, Twitter, Telegram with CSRF state tokens |
| **Input Validation** | class-validator + class-transformer | DTO validation with whitelist + forbidNonWhitelisted |

## Microservices

| Service | Language | Runtime | Communication |
|---------|----------|---------|--------------|
| **ws-hub** | Go 1.22 | Native binary | Redis Pub/Sub → Native WebSocket |
| **curve-engine** | Rust 1.78 | gRPC server | gRPC (proto/curve.proto) |
| **order-matcher** | Rust 1.78 | RabbitMQ consumer | AMQP (artcurve.orders → artcurve.matches) |

## Infrastructure

| Component | Technology | Purpose |
|-----------|-----------|---------|
| **Container** | Docker + docker-compose | Local dev and deployment |
| **API Docs** | Swagger / OpenAPI 3 | Auto-generated from decorators (dev only) |
| **Security** | Helmet | CSP, HSTS, X-Frame-Options, CORP, COOP |
| **Rate Limiting** | @nestjs/throttler | Per-endpoint rate limits with Redis storage |
| **Deployment** | Render | Auto-deploy from main branch |
| **Blockchain Network** | Base L2 | Chain 84532 (Sepolia testnet) / 8453 (Mainnet) |

## Key Libraries

| Library | Purpose |
|---------|---------|
| `ioredis` | Redis client with cluster support |
| `amqplib` | RabbitMQ client |
| `@clickhouse/client` | ClickHouse HTTP client |
| `Decimal.js` | Arbitrary-precision arithmetic for financial calculations |
| `@livekit/server-sdk` | LiveKit room and token management |
| `@pinata/sdk` | IPFS file and JSON pinning |
