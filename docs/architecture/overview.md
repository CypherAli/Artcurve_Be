# System Architecture

> ArtCurve Backend — Fractionalized Art Trading DApp on Base L2

## Architecture Diagram

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

## Component Overview

### NestJS API (`src/`)
The primary REST API server built with NestJS 10 and TypeScript 5. Handles authentication (SIWE + OAuth), artwork management, trade analytics, portfolio tracking, social features, and live streaming. Runs on port 3001.

Key responsibilities:
- REST API with Swagger/OpenAPI documentation
- WebSocket gateways (Socket.IO) for real-time price updates
- Blockchain event indexing via viem
- Background jobs: backup scheduler, price cache refresh

### Go WebSocket Hub (`services/ws-hub/`)
A lightweight native WebSocket server written in Go. Subscribes to Redis Pub/Sub channel `artwork:price:updated` and broadcasts price updates to connected clients with lower latency than Socket.IO at scale.

- Port: 8080
- Protocol: Native WebSocket (not Socket.IO)
- Health: `GET /health`
- Metrics: `GET /metrics`

### Rust Bonding Curve Engine (`services/curve-engine/`)
gRPC service for bonding curve price calculations. Supports three curve types: LINEAR, QUADRATIC (default), and EXPONENTIAL. The NestJS API also includes a TypeScript in-process implementation (`shared/curve-engine`) as a fallback.

- Port: 50051 (gRPC)
- Proto definition: `proto/curve.proto`
- RPCs: GetSpotPrice, GetBuyCost, GetSellReturn, GetMarketCap, GetPriceCurve

### Rust Order Matcher (`services/order-matcher/`)
Off-chain order book engine for limit orders. Consumes from RabbitMQ queue `artcurve.orders`, publishes matched results to `artcurve.matches` and rejected orders to `artcurve.rejects`.

Supports Market orders (fill immediately at spot price) and Limit orders (queue until price matches).

### Solidity Smart Contracts (`contracts/`)
Built with Foundry. Three core contracts deployed on Base L2:
- **ArtFactory.sol** — Factory that deploys a BondingCurveAMM clone per artwork
- **BondingCurveAMM.sol** — Automated Market Maker with bonding curve buy/sell logic
- **ArtFractionToken.sol** — ERC-1155 fractionalized art token

## Data Flow

```
User Action (Buy Shares)
    │
    ▼
Frontend → BondingCurveAMM.buy() on Base L2
    │
    ▼
viem watchContractEvent catches TradeExecuted event
    │
    ▼
IndexerService publishes to RabbitMQ (artcurve.blockchain / trade.executed)
    │
    ├──► BlockchainEventConsumer:
    │       1. Upsert transaction in PostgreSQL (idempotent via tx_hash)
    │       2. Update portfolio_holdings (share_balance, avg_buy_price)
    │       3. Update artwork current_price and current_supply
    │       4. Async insert to ClickHouse (OHLCV aggregation)
    │       5. Publish to Redis: artwork:price:updated
    │
    └──► Redis Pub/Sub → Socket.IO /prices gateway → Frontend WebSocket
                       → Go ws-hub → Frontend native WebSocket
```

## Monorepo Structure

```
Artcurve_BE/
├── src/                        ← NestJS API (TypeScript)
│   ├── modules/                ← Feature modules (auth, artworks, trades, etc.)
│   ├── database/               ← Entities, migrations, data-source
│   └── shared/                 ← Shared utilities, ClickHouse schema
├── services/
│   ├── ws-hub/                 ← Go — Native WebSocket Hub
│   ├── curve-engine/           ← Rust — gRPC Bonding Curve Engine
│   └── order-matcher/          ← Rust — Off-chain Order Matcher
├── contracts/                  ← Solidity — Foundry smart contracts
├── scripts/                    ← Utility scripts (backup, seed)
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
