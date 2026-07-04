# PROJECT.md — Artcurve_Be (Backend API)

> Core API server của nền tảng ArtCurve — NestJS 10 · TypeScript 5 · PostgreSQL 16 ·
> Redis 7 · ClickHouse. Deploy trên Render.

## 1. Vai trò trong hệ thống

Trung tâm điều phối toàn bộ nghiệp vụ off-chain: xác thực, quản lý artwork, đồng bộ
dữ liệu blockchain, phân tích giao dịch, real-time gateway, chat AI, social.
Mọi client (FE, back-office, price-agent) đều đi qua API này.

## 2. Chức năng chính (17 module)

| Nhóm | Module | Mô tả |
|---|---|---|
| Xác thực | `auth` | Sign-In With Ethereum (SIWE/EIP-4361) + OAuth GitHub/Twitter/Telegram, JWT + blacklist |
| Nghiệp vụ lõi | `artworks` | CRUD artwork, upload IPFS (Pinata), state machine DRAFT→AI_MODERATING→ACTIVE→TARGET_REACHED→GRADUATED |
| | `trades` | Lịch sử giao dịch, biểu đồ nến OHLCV (ClickHouse Materialized Views), leaderboard |
| | `portfolio`, `vault` | Holdings, tính P&L bằng Decimal.js (không dùng float) |
| Blockchain | `blockchain` | Pipeline: viem watcher đọc event Base L2 → RabbitMQ → processor → PG + Redis + ClickHouse |
| Real-time | `gateway` | WebSocket (Socket.IO) đẩy giá; ws-hub (Go) gánh tải chính |
| AI | `chat` | Chatbot hỗ trợ (Gemini) + escalation ticket |
| | `moderation` | Gọi Artcurve_AI `/detect` kiểm tra tranh AI-generated |
| Cộng đồng | `social`, `guild`, `live`, `notifications` | Follow/like/review, hội nhóm, livestream (LiveKit), thông báo |
| Vận hành | `security`, `health`, `metrics`, `users` | Audit log, chống brute-force, health check, Prometheus |

## 3. Kiến trúc dữ liệu

- **PostgreSQL** (TypeORM, 24 migration) — nguồn sự thật: users, artworks, transactions,
  holdings, guild, chat...
- **Redis** — cache versioned-namespace, pub/sub giá real-time, nonce SIWE, JWT blacklist.
- **ClickHouse** — OHLCV candlestick, analytics khối lượng lớn.
- **RabbitMQ** — hàng đợi event blockchain + lệnh giao dịch.

## 4. Tích hợp ngoài

| Hướng | Service | Giao thức |
|---|---|---|
| → | artcurve-curve-engine | gRPC :50051 (tính giá) |
| ⇄ | artcurve-order-matcher | RabbitMQ `artcurve.orders/matches/rejects` |
| → | artcurve-ws-hub | Redis pub/sub `artwork:price:updated`, `artwork:graduated` |
| → | Pinata (IPFS), Gemini, LiveKit, Artcurve_AI | HTTPS |
| ← | Base L2 | viem event watcher |

## 5. Bảo mật & chất lượng

- Rate-limit toàn cục (Throttler 120 req/phút), guard per-endpoint.
- Circuit breaker cho external call; correlation-id middleware cho tracing.
- Env validate bằng Joi schema lúc boot — thiếu biến là fail-fast.
- **15 test suite / 124 test — pass 100%.**

## 6. Trạng thái

✅ Hoàn chỉnh về code + test. Deploy Render (DB SSL self-signed đã xử lý).
⚠️ Data hiện là seed mô phỏng — chờ contract chạy testnet/mainnet để có giao dịch thật.
