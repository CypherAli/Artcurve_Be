# Artcurve_Be — Hướng dẫn cho Claude

Backend API chính của ArtCurve (NestJS 10 · TypeScript · PostgreSQL · Redis · ClickHouse).

## Lệnh

```bash
npm run start:dev     # dev server :3001 — prefix /api/v1, Swagger UI: /api/docs
npm test              # jest — 15 suite / 134 test, phải xanh trước khi merge
npm run build         # tsc build
npx typeorm migration:run -d dist/database/data-source.js   # chạy migration thủ công
npx ts-node src/database/seeds/seed.ts                      # bơm data giả để test
```

## Cấu trúc

```
src/
├── app.module.ts          # Root module — THỨ TỰ IMPORT QUAN TRỌNG (đọc comment trong file)
├── config/                # env validation (Joi schema)
├── database/
│   ├── data-source.ts     # DataSource cho TypeORM CLI (migration/seed)
│   ├── database.module.ts # TypeORM runtime config (forRootAsync)
│   ├── migrations/        # 25 migration — KHÔNG sửa migration cũ, tạo migration mới
│   └── seeds/seed.ts      # data giả
├── shared/                # @Global: redis, clickhouse, curve-engine (gRPC), onchain-quote
├── common/                # interceptors, pagination (cursor), resilience (circuit breaker)
└── modules/               # 18 feature module
    ├── auth/              # SIWE (EIP-4361) + OAuth + JWT
    ├── artworks/          # CRUD + IPFS (Pinata) + state machine DRAFT→GRADUATED
    ├── trades/            # OHLCV (ClickHouse), lịch sử, leaderboard
    ├── portfolio/ vault/  # holdings, P&L (Decimal.js)
    ├── blockchain/        # @Global: viem watcher → RabbitMQ → processor → PG+Redis+CH
    ├── gateway/           # WebSocket giá real-time
    ├── chat/              # AI chat (Gemini) + escalation
    ├── social/ guild/ live/ notifications/ moderation/ users/
    └── security/ health/ metrics/
```

## Quy ước repo này

- **State machine artwork:** transition hợp lệ khai báo trong `artworks.service.ts`
  (`VALID_TRANSITIONS`) — thêm trạng thái phải cập nhật cả FE + contract.
- **Migration:** luôn tạo file mới `<timestamp>-TenMigration.ts`, không sửa migration đã chạy.
  `migrationsRun: true` — app tự chạy pending migration lúc start.
- **Cache:** dùng `RedisService` helpers (`cacheGetJson`/`cacheSetJson` + versioned namespace),
  không gọi ioredis raw trong feature module.
- **Test:** service nào thêm dependency vào constructor → PHẢI cập nhật mock trong
  `*.service.spec.ts` tương ứng (lỗi "Nest can't resolve dependencies" trong CI).
- **SSL production:** Render Postgres dùng cert self-signed —
  `DB_SSL_REJECT_UNAUTHORIZED` mặc định `false` (xem `database.module.ts`). Đừng bật `true`.
- **Tiền tệ:** mọi số tiền/giá dùng string + Decimal.js, KHÔNG dùng float.

## Deploy

- **Render** (không dùng Railway). Cần env: `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`,
  `PINATA_*`, `NODE_ENV=production`. Health check: `GET /health`.

## Skills — bảng chỉ đường (`.claude/skills/`)

Khi task khớp loại việc dưới đây, LUÔN đọc skill tương ứng trước khi code:

| Loại task | Skill bắt buộc |
|---|---|
| Tạo module/controller/provider/DTO NestJS | `nestjs-patterns` · cấu trúc module & boundary → `nestjs-architecture` |
| Swagger / OpenAPI decorators, spec, contract | `openapi-expert` · validate spec-vs-code → `openapi-schema-validation` |
| Query/schema ClickHouse (OHLCV, analytics) | `clickhouse-io` |
| RabbitMQ / queue / event-driven / background job | `using-message-queues` |
| WebSocket / real-time / push | `websocket` |
| Đọc/ghi chain bằng viem (watcher, script, service) | `viem` (KHÔNG dùng cho React — đó là việc của FE) |
| Indexer, event processing, reorg, sync on-chain | `web3-backend-eng` · đọc dữ liệu lịch sử scale lớn → `indexing` · The Graph subgraph → `subgraph-patterns` |
| Viết/generate contract Solidity | `smart-contract-generator` |
| Test contract (Foundry) | `foundry-testing` (chính) · toolkit Foundry → `foundry` · campaign đầy đủ → `foundry-test-campaign` + `foundry-spec-properties` + `foundry-reference-model` · Hardhat/tổng quát → `smart-contract-testing`, `web3-testing` |
| Audit / security contract | `web3-audit` + `smart-contract-vulnerabilities` |
