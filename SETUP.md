# ArtCurve — Setup & Deploy Guide

## Kiến trúc

```
FE (Next.js / Vercel) ──► BE API (NestJS / Render) ──► PostgreSQL  (migrations tự chạy khi boot)
        │                        │                  ──► Redis       (nonce, JWT blacklist, pub/sub)
        │ wss                    │                  ──► ClickHouse  (OHLCV qua Materialized Views)
        ▼                        │                  ──► RabbitMQ    (blockchain events + order book)
   ws-hub (Go)  ◄── Redis pub/sub┘
                                 ▼
              order-matcher (Rust, RabbitMQ consumer)
              curve-engine  (Rust gRPC — TÙY CHỌN: NestJS có bản
              TypeScript in-process tương đương trong shared/curve-engine)
```

## Local development (1 lệnh)

Yêu cầu: Docker Desktop đang chạy. KHÔNG cần cài Go/Rust — build trong Docker.

```bash
# Toàn bộ hạ tầng + services
docker compose up -d

# Hoặc chỉ hạ tầng (nếu chạy API bằng npm run start:dev)
docker compose up -d postgres redis clickhouse rabbitmq

npm install
npm run migration:run     # 16 migrations — idempotent
npm run start:dev         # API: http://localhost:3001/api/v1
```

ClickHouse schema (`src/shared/clickhouse/schema.sql`) được API tự ensure khi boot
(ClickHouseSchemaService). Nếu cần áp tay:

```bash
cat src/shared/clickhouse/schema.sql | docker exec -i artcurve_clickhouse \
  clickhouse-client --user artcurve --password artcurve_ch_pass \
  --database artcurve_analytics --multiquery
```

Health check: `curl http://localhost:3001/api/v1/health`
ws-hub:       `curl http://localhost:8080/health`

## Chain config — PHẢI đồng bộ 2 phía

| Env                        | Sepolia (hiện tại) | Mainnet (tương lai) |
|----------------------------|--------------------|---------------------|
| BE `CHAIN_ID` (Render)     | `84532`            | `8453`              |
| BE `RPC_URL`               | `https://sepolia.base.org` | `https://mainnet.base.org` |
| FE `NEXT_PUBLIC_CHAIN_ID` (Vercel) | `84532`    | `8453`              |

Contracts (Base Sepolia):
- ArtFactory: `0xBe1F8a192eD168fed99E7F5d479F1A314200F1bF`
- BondingCurveAMM: `0xF8F4233DA0Cc3f6968a239b36010a864c6E9bFb6`

## Production deploy

| Service        | Nơi deploy | Trạng thái | Ghi chú |
|----------------|-----------|------------|---------|
| API (NestJS)   | Render web service | ✅ live | migrations tự chạy khi boot |
| PostgreSQL     | Render Postgres    | ✅ live | |
| Redis          | Render Key-Value / Upstash | ✅ live | |
| ClickHouse     | ClickHouse Cloud   | ✅ live | |
| ws-hub (Go)    | Render web service | ❌ CHƯA — cần tạo | xem bên dưới |
| order-matcher  | Render worker (trả phí) hoặc chạy local | ❌ CHƯA | cần RabbitMQ cloud (CloudAMQP free) |
| curve-engine   | Không bắt buộc     | — | NestJS dùng bản TS in-process |

### Deploy ws-hub lên Render (free tier)
1. Dashboard → **New → Web Service** → repo `CypherAli/Artcurve_Be`
2. **Root Directory**: `services/ws-hub` · Runtime: **Docker**
3. Env: `PORT=8080`, `REDIS_URL=<URL Redis prod>`,
   `ALLOWED_ORIGINS=https://artcurve-fe.vercel.app`
4. Sau khi live → Vercel: set `NEXT_PUBLIC_WS_HUB_URL=wss://<service>.onrender.com`

`REDIS_URL` chấp nhận cả `redis://`/`rediss://` (có password) lẫn `host:port`.
