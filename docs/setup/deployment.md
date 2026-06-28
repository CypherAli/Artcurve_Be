# Deployment — Render

## Services on Render

| Service | Type | URL |
|---------|------|-----|
| NestJS API | Web Service | https://artcurve-be.onrender.com |
| Go WS Hub | Web Service | wss://artcurve-ws-hub.onrender.com |
| PostgreSQL | Managed DB | Internal connection string |

Order Matcher (Rust) runs as Docker container on local machine (needs Render worker for 24/7).

## Deploy Steps

1. Push to `main` branch on GitHub (`CypherAli/Artcurve_Be`)
2. Render auto-deploys (connected to GitHub)
3. Build: `npm run build`
4. Start: `node dist/main.js`
5. Migrations run automatically on start

## Required Render Env Vars

```
NODE_ENV=production
PORT=3001
DATABASE_URL=<Render internal PostgreSQL URL>
DB_SSL_REJECT_UNAUTHORIZED=false
REDIS_URL=<Upstash Redis URL>
REDIS_SSL_REJECT_UNAUTHORIZED=false
JWT_SECRET=<64+ char random hex>
CORS_ORIGINS=https://artcurve-fe.vercel.app
APP_DOMAIN=artcurve-fe.vercel.app
FRONTEND_URL=https://artcurve-fe.vercel.app
INTERNAL_SERVICE_KEY=<random 40+ char string>
GEMINI_API_KEY=<Google Gemini key>
```

## Health Check

Render health check endpoint: `GET /api/v1/health/ping`

Returns `200 OK` with no dependency checks (liveness probe).

Full health: `GET /api/v1/health` — checks PostgreSQL, Redis, ClickHouse, RabbitMQ, memory.

## Chain Configuration

```
CHAIN_ID=84532          # Base Sepolia testnet
# CHAIN_ID=8453         # Base mainnet (future)
```
