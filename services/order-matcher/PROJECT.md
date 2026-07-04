# PROJECT.md — artcurve-order-matcher (Matching Engine)

> Engine khớp lệnh bất đồng bộ — Rust · tokio · lapin (RabbitMQ).

## 1. Vai trò

Gánh phần xử lý lệnh nặng ra khỏi backend: nhận lệnh mua/bán từ NestJS qua hàng đợi,
kiểm tra chống lại bonding curve book, rồi trả kết quả match/reject về cho NestJS settle.

## 2. Luồng xử lý

```
NestJS ──publish──► RabbitMQ "artcurve.orders"
                        │
                   Rust matcher (BookRegistry — src/book.rs)
                        │ kiểm tra curve state, số dư, slippage
            ┌───────────┴───────────┐
   "artcurve.matches"      "artcurve.rejects"
            │                       │
   NestJS settle vào PG    NestJS notify user
```

## 3. Nguyên tắc thiết kế

- **Stateless với DB:** matcher không đụng PostgreSQL — chỉ consume/publish message.
  Settle (ghi sổ) là trách nhiệm NestJS → tách biệt rõ, dễ scale ngang.
- **Idempotent:** message có thể bị redeliver — xử lý lại không gây double-match.
- **Tên queue là contract** giữa 2 repo: `artcurve.orders|matches|rejects`.

## 4. Vì sao Rust?

Khớp lệnh là hot path — cần latency thấp ổn định (không GC), memory-safe khi xử lý
đồng thời nhiều book (mỗi artwork 1 book trong BookRegistry).

## 5. Chạy

```bash
cargo run          # env: AMQP_URL (default amqp://guest:guest@localhost:5672)
cargo test
docker build .     # có Dockerfile sẵn
```

## 6. Trạng thái

✅ Hoàn chỉnh: consumer/producer AMQP, book registry, Dockerfile.
