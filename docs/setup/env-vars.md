# Environment Variables

All variables are configured in `.env` (local) or Render dashboard (production).

## App

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NODE_ENV` | Yes | `development` | `development` or `production` |
| `PORT` | No | `3001` | HTTP server port |
| `APP_DOMAIN` | Yes | `localhost` | SIWE domain binding |
| `FRONTEND_URL` | Yes | — | Frontend URL for OAuth redirects |
| `CORS_ORIGINS` | Yes | — | Comma-separated allowed origins |

## PostgreSQL

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | Yes* | — | Full connection string (preferred) |
| `DB_HOST` | No | `localhost` | Host (fallback if no DATABASE_URL) |
| `DB_PORT` | No | `5432` | Port |
| `DB_USERNAME` | No | `postgres` | Username |
| `DB_PASSWORD` | No | `postgres` | Password |
| `DB_NAME` | No | `artcurve_db` | Database name |
| `DB_POOL_MAX` | No | `20` | Max connections |
| `DB_POOL_MIN` | No | `2` | Min connections |
| `DB_SSL_REJECT_UNAUTHORIZED` | No | `true` | Set `false` for managed DB with self-signed certs (Render, Supabase) |

## JWT

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `JWT_SECRET` | Yes | — | Min 32 chars, hex recommended |
| `JWT_EXPIRES_IN` | No | `7d` | Access token expiry |

## Redis

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `REDIS_URL` | Yes* | — | Full URL (e.g., `rediss://...` for Upstash) |
| `REDIS_HOST` | No | `localhost` | Fallback host |
| `REDIS_PORT` | No | `6379` | Fallback port |
| `REDIS_PASSWORD` | No | — | Fallback password |
| `REDIS_SSL_REJECT_UNAUTHORIZED` | No | `true` | Set `false` for managed Redis |

## ClickHouse

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `CLICKHOUSE_HOST` | No | `http://localhost:8123` | ClickHouse HTTP endpoint |
| `CLICKHOUSE_DB` | No | `artcurve_analytics` | Database name |
| `CLICKHOUSE_USER` | No | `artcurve` | Username |
| `CLICKHOUSE_PASSWORD` | No | — | Password |

## RabbitMQ

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `RABBITMQ_URL` | No | `amqp://localhost:5672` | AMQP connection string |

## IPFS (Pinata)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PINATA_API_KEY` | No | — | Pinata API key (mock URIs if not set) |
| `PINATA_SECRET_KEY` | No | — | Pinata secret |
| `PINATA_JWT` | No | — | Pinata JWT (alternative auth) |
| `PINATA_GATEWAY` | No | `https://gateway.pinata.cloud` | IPFS gateway URL |

## OAuth

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `GOOGLE_CLIENT_ID` | No | — | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | No | — | Google OAuth secret |
| `GOOGLE_CALLBACK_URL` | No | — | Google OAuth callback URL |

## AI & Moderation

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `GEMINI_API_KEY` | No | — | Google Gemini API (guild character generation) |
| `GOOGLE_VISION_API_KEY` | No | — | Vision AI for NSFW detection |
| `NSFW_SCORE_THRESHOLD` | No | `0.7` | NSFW rejection threshold (0-1) |

## Services

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `INTERNAL_SERVICE_KEY` | Yes | — | Inter-service auth key (random string) |
| `LIVEKIT_URL` | No | — | LiveKit server URL |
| `LIVEKIT_API_KEY` | No | — | LiveKit API key |
| `LIVEKIT_API_SECRET` | No | — | LiveKit API secret |
| `SENTRY_DSN` | No | — | Sentry error tracking DSN |
