# ArtCurve — Backend Monorepo

> Fractionalized Art Trading DApp on Base L2 — NestJS · Go · Rust · Solidity

[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript)](https://www.typescriptlang.org/)
[![Go](https://img.shields.io/badge/Go-1.22-00ADD8?logo=go)](https://go.dev/)
[![Rust](https://img.shields.io/badge/Rust-1.78-CE412B?logo=rust)](https://www.rust-lang.org/)
[![Solidity](https://img.shields.io/badge/Solidity-0.8-363636?logo=solidity)](https://soliditylang.org/)
[![NestJS](https://img.shields.io/badge/NestJS-10.x-E0234E?logo=nestjs)](https://nestjs.com/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-336791?logo=postgresql)](https://www.postgresql.org/)
[![Redis](https://img.shields.io/badge/Redis-7-DC382D?logo=redis)](https://redis.io/)
[![Base L2](https://img.shields.io/badge/Base-L2-0052FF?logo=coinbase)](https://base.org/)

---

## 📚 Documentation

| Tài liệu | Nội dung |
|---|---|
| [docs/PROJECT.md](docs/PROJECT.md) | Tổng quan kiến trúc backend monorepo |
| [docs/SETUP.md](docs/SETUP.md) | Hướng dẫn cài đặt & chạy local chi tiết |
| [docs/DATABASE_DESIGN.md](docs/DATABASE_DESIGN.md) | Thiết kế database (ERD, bảng, quan hệ) |
| [docs/database/schema.md](docs/database/schema.md) | Schema chi tiết từng bảng |
| [docs/SANDBOX.md](docs/SANDBOX.md) | 3 lớp sandbox: Foundry test · Anvil local (coin tùy ý) · Sepolia |
| [AGENTS.md](AGENTS.md) · [CLAUDE.md](CLAUDE.md) | Hướng dẫn cho AI coding agent (phải ở root) |

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Environment Variables](#environment-variables)
- [API Reference](#api-reference)
- [WebSocket Events](#websocket-events)
- [Database](#database)
- [Microservices](#microservices)
- [Deployment](#deployment)
- [Security](#security)
- [Backup Strategy](#backup-strategy)

---

## Overview

ArtCurve Backend is the core API server for a Web3 fractionalized art trading platform. Artists mint artwork shares on Base L2 via bonding curves; collectors buy and sell shares trustlessly on-chain. The backend handles:

- **Auth** — Sign-In With Ethereum (SIWE / EIP-4361) + GitHub / Twitter / Telegram OAuth
- **Artworks** — IPFS metadata upload (Pinata), state machine lifecycle (DRAFT → GRADUATED)
- **Trades** — Real-time price sync from blockchain events, OHLCV analytics (ClickHouse)
- **Portfolio** — Holdings tracking, P&L calculation (Decimal.js precision)
- **Live Streaming** — LiveKit Cloud room management and viewer tokens
- **Social** — Follow, like, comment/review system

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Base L2 Blockchain                       │
│              ArtFactory + BondingCurveAMM contracts             │
└────────────────────────┬────────────────────────────────────────┘
                         │ viem watchContractEvent
                         ▼
┌──────────────────────────────────────────┐
│           NestJS — BlockchainIndexer     │  catch-up + real-time
│           IndexerService (viem)          │
└─────────────────┬────────────────────────┘
                  │ publish
                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                    RabbitMQ Exchange                            │
│            artcurve.blockchain (topic, durable)                 │
│  artwork.created │ trade.executed │ tx.graduated               │
└──────┬───────────┴────────────────┴──────────────┬─────────────┘
       │ consume                                    │
       ▼                                            ▼
┌──────────────────────────┐         ┌──────────────────────────┐
│  BlockchainEventConsumer │         │   OrderMatchConsumer      │
│  (on-chain trade settle) │         │  (Rust off-chain orders)  │
└─────────┬────────────────┘         └────────────┬─────────────┘
          │                                        │
          ▼                                        ▼
┌─────────────────────────────────────────────────────────────────┐
│  PostgreSQL (source of truth)  │  Redis (cache + pub/sub)       │
│  TypeORM + ACID transactions   │  Price cache, JWT blacklist    │
│                                │  Pub/Sub → WebSocket broadcast │
└─────────────────┬──────────────┴────────────────┬──────────────┘
                  │                               │
                  ▼                               ▼
        ClickHouse (analytics)          Socket.IO Gateways
        OHLCV Materialized Views        /prices  — public
        volume_daily aggregates         /events  — JWT required
                                                │
                                        Frontend clients
```

### Monorepo Structure

```
Artcurve_BE/
├── src/                        ← NestJS API (TypeScript)
├── services/
│   ├── ws-hub/                 ← Go — Native WebSocket Hub
│   ├── curve-engine/           ← Rust — gRPC Bonding Curve Engine
│   └── order-matcher/          ← Rust — Off-chain Order Matcher
├── contracts/                  ← Solidity — Foundry smart contracts
│   ├── src/                    ← ArtFactory, BondingCurveAMM, ArtFractionToken
│   ├── test/                   ← Foundry tests
│   └── script/                 ← Deploy scripts
├── docker-compose.yml          ← Full stack (infra + all services)
└── README.md
```

| Service | Language | Port | Role |
|---------|----------|------|------|
| `src/` (NestJS) | TypeScript | 3001 | REST API, WebSocket gateways, blockchain indexer |
| `services/ws-hub` | Go | 8080 | Native WebSocket hub subscribed to Redis Pub/Sub |
| `services/curve-engine` | Rust (gRPC) | 50051 | Bonding curve price calculations |
| `services/order-matcher` | Rust (RabbitMQ) | — | Off-chain order book matching |
| `contracts/` | Solidity (Foundry) | — | ArtFactory + BondingCurveAMM on Base L2 |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Framework** | NestJS 10, TypeScript 5 |
| **Database** | PostgreSQL 16 (TypeORM, migrations) |
| **Cache / PubSub** | Redis 7 (ioredis) |
| **Analytics** | ClickHouse (OHLCV Materialized Views) |
| **Message Queue** | RabbitMQ (amqplib) |
| **Blockchain** | viem, Base L2 (chain 8453 / 84532 testnet) |
| **WebSocket** | Socket.IO (NestJS gateway) |
| **Live Streaming** | LiveKit Cloud SDK |
| **IPFS** | Pinata (file + JSON pin) |
| **Auth** | SIWE (EIP-4361), JWT (RS256), GitHub/Twitter/Telegram OAuth |
| **Validation** | class-validator, class-transformer |
| **Docs** | Swagger / OpenAPI 3 |
| **Container** | Docker + docker-compose |

---

## Prerequisites

- Node.js ≥ 20
- pnpm ≥ 9 (or npm / yarn)
- PostgreSQL 16
- Redis 7
- RabbitMQ 3.12 (optional in dev — consumers self-skip if unavailable)
- ClickHouse 23+ (optional — trades module degrades gracefully)

---

## Quick Start

```bash
# 1. Clone repo
git clone https://github.com/CypherAli/Artcurve_BE.git
cd Artcurve_BE

# 2. Install dependencies
npm install

# 3. Copy env file and fill in values
cp .env.example .env

# 4. Start infrastructure (PostgreSQL + Redis + RabbitMQ)
docker-compose up -d postgres redis rabbitmq

# 5. Run database migrations
npm run migration:run

# 6. (Optional) Seed sample data
npm run seed

# 7. Start development server
npm run start:dev
```

API available at: `http://localhost:3001/api/v1`  
Swagger UI: `http://localhost:3001/api/docs`

---

## Environment Variables

Create a `.env` file in the project root. All variables below are required unless marked optional.

```env
# ── App ─────────────────────────────────────────────────────────────────────
NODE_ENV=development
PORT=3001
APP_URI=https://artcurve-be-production.up.railway.app

# ── PostgreSQL ───────────────────────────────────────────────────────────────
DATABASE_URL=postgresql://postgres:password@localhost:5432/artcurve_db
# Or split:
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=postgres
DB_PASSWORD=password
DB_NAME=artcurve_db
DB_POOL_MAX=20
DB_POOL_MIN=2

# ── Redis ────────────────────────────────────────────────────────────────────
REDIS_URL=redis://localhost:6379
# Or split:
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# ── ClickHouse (optional) ────────────────────────────────────────────────────
CLICKHOUSE_HOST=localhost
CLICKHOUSE_PORT=8123
CLICKHOUSE_USER=default
CLICKHOUSE_PASSWORD=
CLICKHOUSE_DB=artcurve

# ── RabbitMQ ─────────────────────────────────────────────────────────────────
RABBITMQ_URL=amqp://guest:guest@localhost:5672
AMQP_URL=amqp://guest:guest@localhost:5672

# ── JWT ──────────────────────────────────────────────────────────────────────
JWT_SECRET=your-super-secret-key-minimum-32-chars
JWT_EXPIRES_IN=7d

# ── Blockchain (Base L2) ─────────────────────────────────────────────────────
RPC_URL=https://mainnet.base.org
CHAIN_ID=8453
ART_FACTORY_ADDRESS=0xYourFactoryContractAddress

# ── IPFS (Pinata) ────────────────────────────────────────────────────────────
PINATA_API_KEY=your_pinata_api_key
PINATA_SECRET_API_KEY=your_pinata_secret
PINATA_GATEWAY=https://gateway.pinata.cloud

# ── LiveKit ──────────────────────────────────────────────────────────────────
LIVEKIT_API_KEY=your_livekit_api_key
LIVEKIT_API_SECRET=your_livekit_api_secret
LIVEKIT_URL=wss://artcurve-3el8ft2f.livekit.cloud

# ── OAuth (optional) ─────────────────────────────────────────────────────────
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
TWITTER_API_KEY=
TWITTER_API_SECRET=
TELEGRAM_BOT_TOKEN=

# ── CORS ─────────────────────────────────────────────────────────────────────
CORS_ORIGINS=https://artcurve-fe.vercel.app,http://localhost:3000
FRONTEND_URL=https://artcurve-fe.vercel.app
```

---

## API Reference

Base URL: `/api/v1`  
Full interactive docs: `GET /api/docs` (Swagger UI, development only)

### Auth — SIWE (EIP-4361)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/auth/nonce` | Public | Get SIWE message for wallet signing |
| `POST` | `/auth/verify` | Public | Submit signature → receive JWT |
| `POST` | `/auth/logout` | JWT | Revoke current JWT (Redis blacklist) |
| `GET` | `/auth/github` | Public | GitHub OAuth redirect |
| `GET` | `/auth/twitter` | Public | Twitter OAuth redirect |
| `GET` | `/auth/telegram` | Public | Telegram OAuth redirect |

**SIWE Flow:**
```
POST /auth/nonce   { wallet_address }
                   → { nonce, message }
                   
[Client signs message with MetaMask]

POST /auth/verify  { wallet_address, signature, message }
                   → { access_token, user }

Authorization: Bearer <access_token>
```

### Artworks

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/artworks` | Public | Marketplace listing (sortBy: price, created_at, view_count, **trending**) |
| `GET` | `/artworks/search` | Public | Full-text search + category/curve_type filter |
| `GET` | `/artworks/my` | JWT | Creator's own artworks (all statuses) |
| `GET` | `/artworks/stats` | Public | Platform stats (artwork count, total volume, collectors) |
| `GET` | `/artworks/:id` | Public | Artwork detail + creator info |
| `GET` | `/artworks/:id/ohlcv` | Public | OHLCV candles (ClickHouse MV) |
| `GET` | `/artworks/:id/history` | Public | Trade history paginated |
| `POST` | `/artworks/upload` | JWT | Upload image → IPFS (Pinata), get `image_uri` + `metadata_uri` |
| `POST` | `/artworks` | JWT | Create DRAFT artwork |
| `PATCH` | `/artworks/:id/status` | JWT | State machine transition |
| `POST` | `/artworks/:id/view` | Public | Increment view count (fire-and-forget) |

**Artwork State Machine:**
```
DRAFT ──→ AI_MODERATING ──→ ACTIVE ──→ TARGET_REACHED ──→ GRADUATED
```

### Artwork Type Filter

Artworks can be filtered by type (creator self-declares when uploading):

| Type | Description |
|------|-------------|
| `ORIGINAL` | Hand-made artwork (painting, digital art, etc.) |
| `AI_GENERATED` | Fully AI-generated artwork |
| `AI_ASSISTED` | Human-created with AI assistance |

```bash
# Filter by type
GET /artworks?artwork_type=ORIGINAL
GET /artworks?artwork_type=AI_GENERATED
GET /artworks/search?artwork_type=ORIGINAL&q=sunset
```

### Trades

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/trades/:artworkId/ohlcv` | Public | OHLCV candles (timeframe: 1m, 5m, 15m, 1h, 4h, 1d) |
| `GET` | `/trades/:artworkId/history` | Public | Raw trade history (ClickHouse) |
| `GET` | `/trades/:artworkId/volume` | Public | 24h volume in ETH |
| `GET` | `/trades/leaderboard` | Public | Top artworks by volume (7d) |
| `GET` | `/trades/recent` | Public | Recent trades across platform (activity feed) |

### Portfolio

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/portfolio/me/pnl` | JWT | Portfolio P&L with unrealized gains (Decimal.js) |
| `GET` | `/portfolio/me/holdings/:artworkId` | JWT | Holding for specific artwork |
| `GET` | `/portfolio/artworks/:artworkId/holders` | JWT | Top holders leaderboard (RANK window function) |

### Users

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/users/me` | JWT | Current user profile |
| `PATCH` | `/users/me` | JWT | Update profile (username, bio, avatar, twitter) |
| `GET` | `/users/top-creators` | Public | Top creators by artwork count |
| `GET` | `/users/:walletAddress` | Public | Public profile by wallet address |

### Social

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/social/follow/:userId` | JWT | Follow a user |
| `DELETE` | `/social/follow/:userId` | JWT | Unfollow a user |
| `GET` | `/social/followers/:userId` | Public | User's followers list |
| `GET` | `/social/following/:userId` | Public | Users being followed |
| `POST` | `/social/like/:artworkId` | JWT | Like an artwork |
| `DELETE` | `/social/like/:artworkId` | JWT | Unlike an artwork |
| `GET` | `/social/likes/:artworkId/count` | Public | Like count |
| `POST` | `/social/comment/:artworkId` | JWT | Post comment/review (optional 1-5 star rating) |
| `GET` | `/social/comments/:artworkId` | Public | Comments paginated |
| `DELETE` | `/social/comment/:commentId` | JWT | Delete own comment |
| `GET` | `/social/stats/:artworkId` | Public | Likes + comments + avg rating |

### Live Streaming

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/live/create` | JWT | Create LiveKit room, get host token |
| `GET` | `/live` | Public | List active streams |
| `GET` | `/live/:roomName` | Public | Stream info |
| `GET` | `/live/:roomName/viewer-token` | Public | Viewer JWT for LiveKit |
| `DELETE` | `/live/:roomName` | JWT | End stream (host only) |
| `POST` | `/live/webhook` | Public | LiveKit Cloud webhook (viewer_count sync) |

---

## WebSocket Events

### `/prices` namespace — Public (no auth)

Connect: `io('https://api.artcurve.io/prices', { transports: ['websocket'] })`

**Client → Server:**
```js
socket.emit('subscribe_artwork',   { artwork_id: 'uuid' })
socket.emit('unsubscribe_artwork', { artwork_id: 'uuid' })
```

**Server → Client:**
```js
// Immediate price snapshot on subscribe
socket.on('price_snapshot', ({ artwork_id, current_price, current_supply, volume_24h, updated_at }) => {})

// Real-time update on every trade
socket.on('price_update', ({ artwork_id, current_price, current_supply, volume_24h, timestamp, is_buy, user_wallet, share_amount }) => {})

// Artwork graduated to DEX
socket.on('artwork_graduated', ({ artwork_id, timestamp }) => {})
```

### `/events` namespace — JWT required

Connect: `io('https://api.artcurve.io/events', { auth: { token: 'Bearer eyJ...' }, transports: ['websocket'] })`

**Server → Client:**
```js
socket.on('trade_updated', ({ artwork_id, tx_hash, is_buy, user_wallet, share_amount, eth_amount, price_per_share, block_number, timestamp }) => {})
socket.on('price_snapshot', { ... })
socket.on('artwork_graduated', { artwork_id, timestamp })
```

---

## Database

### Migrations

```bash
# Run all pending migrations
npm run migration:run

# Revert last migration
npm run migration:revert

# Generate new migration from entity changes
npm run migration:generate -- src/database/migrations/MigrationName

# Create empty migration
npm run migration:create -- src/database/migrations/MigrationName
```

### Schema Overview

| Table | Purpose |
|-------|---------|
| `users` | Wallet addresses, OAuth profiles, roles |
| `artworks` | Artwork metadata, bonding curve params, status |
| `transactions` | Trade history (BUY / SELL / GRADUATE) |
| `portfolio_holdings` | User share balances + weighted avg buy price |
| `followers` | Follow relationships |
| `social_interactions` | Likes, comments, ratings |
| `moderation_logs` | AI moderation decisions |
| `live_streams` | LiveKit room metadata, viewer counts |

### ClickHouse Tables

| Table / View | Purpose |
|-------------|---------|
| `trades` | Raw trade events (high-write, async insert) |
| `ohlcv_1m` | 1-minute candles (Materialized View) |
| `ohlcv_5m` | 5-minute candles (Materialized View) |
| `ohlcv_1h` | 1-hour candles (Materialized View) |
| `volume_daily` | Daily volume per artwork (Materialized View) |

---

## Microservices

### services/ws-hub (Go)

Native WebSocket server that subscribes to Redis `artwork:price:updated` channel and broadcasts to connected clients. Replaces Socket.IO for lower latency at scale.

```
Endpoint: ws://hub-host:8080/ws
Health:   GET /health
Metrics:  GET /metrics

Client protocol:
  → { "action": "subscribe",   "artwork_id": "uuid" }
  ← { "type": "price_update",  "data": { ... } }

Env: PORT, REDIS_URL, REDIS_PASSWORD, ALLOWED_ORIGINS
```

### services/curve-engine (Rust gRPC)

Bonding curve price calculation service. Replaces Python price agent.

```
Port: :50051 (gRPC)
Proto: proto/curve.proto

RPCs:
  GetSpotPrice(artwork_id, supply) → price
  GetBuyCost(artwork_id, supply, amount) → cost
  GetSellReturn(artwork_id, supply, amount) → return
  GetMarketCap(artwork_id, supply) → market_cap
  GetPriceCurve(artwork_id, points) → [price]

Curves: LINEAR  P₀ + slope·s
        QUADRATIC P₀ + slope·s²   (default)
        EXPONENTIAL P₀·eᵏˢ

Env: GRPC_PORT=50051
```

### services/order-matcher (Rust)

Off-chain order book for limit orders. Consumes from RabbitMQ `artcurve.orders`, publishes results to `artcurve.matches` / `artcurve.rejects`.

```
Queues: artcurve.orders   ← NestJS submits orders
        artcurve.matches  → filled order results
        artcurve.rejects  → rejected orders

Order types: Market (fill immediately at spot price)
             Limit  (queue, fill when price matches)

Env: AMQP_URL=amqp://guest:guest@localhost:5672
```

---

## Smart Contracts

Located in `contracts/` — built with [Foundry](https://book.getfoundry.sh/).

### Contracts

| Contract | Description |
|----------|-------------|
| `ArtFactory.sol` | Factory contract — deploys AMM clone per artwork |
| `BondingCurveAMM.sol` | Automated Market Maker — bonding curve buy/sell logic |
| `ArtFractionToken.sol` | ERC-1155 fractionalized art token |

### Commands

```bash
cd contracts

# Install Foundry (first time)
curl -L https://foundry.paradigm.xyz | bash && foundryup

# Install dependencies
forge install

# Run tests
forge test -vv

# Deploy to Base Sepolia
forge script script/Deploy.s.sol --rpc-url $RPC_URL --broadcast --verify

# Check deployed addresses
cat broadcast/Deploy.s.sol/84532/run-latest.json
```

### Deployed (Base Sepolia — Chain 84532)

See `contracts/broadcast/Deploy.s.sol/84532/run-latest.json` for latest deployed addresses.

---

## Deployment

### Render (current)

The main API is deployed on [Render](https://render.com) connected to the `main` branch. Pushes to `main` trigger automatic redeploys.

```
Live API: https://artcurve-be-production.up.railway.app/api/v1
```

**Required environment variables** must be set in the Render dashboard (see [Environment Variables](#environment-variables) section).

**Run migrations after deploy:**
```bash
npx typeorm migration:run -d dist/database/data-source.js
```

### Docker

```bash
# Build image
docker build -t artcurve-be .

# Run with env file
docker run -p 3001:3001 --env-file .env artcurve-be
```

### Docker Compose (full stack)

```bash
docker-compose up -d
```

Services started: PostgreSQL, Redis, RabbitMQ, ClickHouse, NestJS API.

---

## Security

### Authentication & Authorization
- **SIWE** (EIP-4361) — Sign-In With Ethereum, nonce-based replay protection
- **JWT** — 15min access + 30-day refresh, rotation, Redis blacklist for revoked tokens
- **OAuth** — GitHub, Google, Twitter, Telegram with CSRF state tokens
- **Role guards** — Global JWT guard with `@Public()` bypass decorator

### Brute Force Protection
- Failed login tracking per IP (Redis, 15-minute sliding window)
- Auto-block IP after 5 failed attempts (30-minute ban)
- `BruteForceGuard` applied to `/auth/verify`
- All events logged to `security_events` table

### Rate Limiting
| Endpoint | Limit | Purpose |
|----------|-------|---------|
| `POST /auth/nonce` | 10/min | Anti-spam |
| `POST /auth/verify` | 5/min + brute force guard | Anti-hack |
| `POST /artworks` | 1/30min | Prevent artwork spam |
| `POST /artworks/upload` | 1/30min | Prevent upload spam |
| `GET /artworks/:id/quote` | 30/min | Anti-scraping |
| Global default | 120/min | DDoS baseline |

### Security Event Logging
All auth events are recorded in `security_events` table:
- `LOGIN_SUCCESS`, `LOGIN_FAILED`, `BRUTE_FORCE_BLOCKED`, `TOKEN_REVOKED`
- Fields: event_type, wallet_address, ip_address, user_agent, severity, metadata

### Security Headers
- Helmet (CSP, CORP, COOP, X-Frame-Options, HSTS)
- CORS strict whitelist (env `CORS_ORIGINS`)
- Input validation: `ValidationPipe` with whitelist + forbidNonWhitelisted

### Security Endpoints
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/health/security` | Public | Recent 10 security events |
| GET | `/health/backup` | Public | Backup status |
| POST | `/health/backup/run` | JWT | Trigger manual backup |

---

## Backup Strategy

### Automated Daily Backup
- **Schedule**: Daily at 03:00 UTC (production only)
- **Method**: `pg_dump` → gzip compression
- **Retention**: Last 7 backups, older auto-deleted
- **Storage**: `backups/` directory (gitignored)

### Manual Backup
```bash
# Via API (requires JWT auth)
curl -X POST https://artcurve-be.onrender.com/api/v1/health/backup/run \
  -H "Authorization: Bearer <token>"

# Via script
./scripts/backup.sh                  # local DB
DATABASE_URL="..." ./scripts/backup.sh --production  # production
```

### Check Status
```bash
curl https://artcurve-be.onrender.com/api/v1/health/backup
# { "lastBackupTime": "2026-06-29T03:00:00Z", "lastBackupStatus": "success", "lastBackupSize": "12.5 MB" }
```

---

## Scripts

```bash
npm run start:dev        # Development with hot-reload
npm run start:prod       # Production (compiled)
npm run build            # Compile TypeScript
npm run migration:run    # Apply pending migrations
npm run migration:revert # Revert last migration
npm run seed             # Seed sample data
npm run test             # Unit tests
npm run test:e2e         # End-to-end tests
npm run lint             # ESLint
```

---

## License

Private — ArtCurve Team © 2026
