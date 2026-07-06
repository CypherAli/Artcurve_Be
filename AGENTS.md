# AGENTS.md — Artcurve_Be

Backend monorepo của ArtCurve (NestJS · TypeScript · PostgreSQL · Redis · ClickHouse,
kèm contracts Solidity + 3 microservice Rust/Go). File này dành cho AI coding agent;
convention chi tiết + **bảng chỉ đường skill**: xem `CLAUDE.md`.

## Setup & lệnh

```bash
npm install
cp .env.example .env        # điền DATABASE_URL, REDIS_URL, JWT_SECRET, PINATA_*
npm run start:dev           # :3001 — prefix /api/v1, Swagger UI: /api/docs (cần PG + Redis chạy sẵn)
npm test                    # PHẢI 134/134 pass trước khi merge
npm run build

# Trong monorepo:
cd contracts && forge test                      # smart contracts (Foundry)
cd contracts && .\sandbox.ps1                   # Anvil sandbox local — xem docs/SANDBOX.md
cd contracts && .\chaos.ps1                     # thử phá hệ thống (adversarial) trên sandbox
.\doctor.ps1                                    # chẩn đoán môi trường dev (-Fix để tự sửa)
cd services/curve-engine && cargo run           # gRPC :50051
cd services/order-matcher && cargo run          # AMQP consumer
cd services/ws-hub && go run .                  # WebSocket hub
```

## Quy tắc

1. **Test trước — merge sau.** Thêm dependency vào constructor service nào thì cập nhật
   mock trong spec tương ứng, nếu không CI fail "Nest can't resolve dependencies".
2. **Migration:** chỉ tạo mới (`src/database/migrations/<timestamp>-Ten.ts`), không sửa cũ.
   `migrationsRun: true` — app tự chạy pending migration lúc start.
3. **Tiền tệ:** string + Decimal.js — cấm float.
4. **Git:** branch → merge main; không logo Claude / Co-Authored-By trong commit.
5. **Không commit `.env`**; deploy trên Render (không Railway).
6. **SSL production:** giữ `DB_SSL_REJECT_UNAUTHORIZED=false` mặc định (cert self-signed
   của Render Postgres).
7. **Thứ tự import trong `app.module.ts` có ý nghĩa** — đọc comment đầu file trước khi đổi.

## Kiến trúc nhanh

- `src/modules/` — 17 feature module (auth SIWE, artworks + state machine, trades OHLCV,
  blockchain indexer, gateway WS, chat Gemini, guild, live, social, security...).
- `src/shared/` — module @Global: Redis, ClickHouse, gRPC curve-engine client.
- `src/database/` — TypeORM: `database.module.ts` (runtime) + `data-source.ts` (CLI).
- `src/common/` — interceptors, cursor pagination, circuit breaker.
- `contracts/` — ArtFactory, ArtFractionToken, BondingCurveAMM (Solidity 0.8.24).
- `services/` — curve-engine (Rust gRPC), order-matcher (Rust AMQP), ws-hub (Go).

## Tích hợp ngoài

| Hướng | Cái gì |
|---|---|
| gRPC out | `services/curve-engine` :50051 — tính giá bonding curve |
| AMQP out/in | RabbitMQ `artcurve.orders` → `artcurve.matches`/`artcurve.rejects` (order-matcher) |
| Redis pub | kênh giá real-time → `services/ws-hub` |
| HTTP out | Pinata (IPFS), Gemini (chat), LiveKit (live), Artcurve_AI `/detect` + `/similarity` |
| Chain in | viem watcher đọc event từ Base L2 (8453 / 84532) |

Sửa 1 bên của các điểm nối trên → kiểm tra bên kia (chi tiết: `../AGENTS.md`).
