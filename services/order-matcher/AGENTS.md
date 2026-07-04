# AGENTS.md — artcurve-order-matcher

Engine khớp lệnh (Rust · tokio · lapin/RabbitMQ).

## Luồng

```
NestJS → RabbitMQ "artcurve.orders"
  → matcher xử lý theo bonding curve book (src/book.rs)
    → "artcurve.matches"  → NestJS settle vào PostgreSQL
    → "artcurve.rejects"  → NestJS báo user bị từ chối
```

## Lệnh

```bash
cargo run                    # env: AMQP_URL (default amqp://guest:guest@localhost:5672), LOG_LEVEL
cargo test
cargo build --release
docker build -t artcurve-order-matcher .
```

## Quy tắc bắt buộc

1. **Tên queue là contract** giữa repo này và `Artcurve_Be` — đổi tên
   `artcurve.orders|matches|rejects` phải sửa cả hai phía.
2. Matcher KHÔNG ghi database — chỉ consume/publish message; settle là việc của NestJS.
3. Message phải idempotent (NestJS có thể retry) — không giả định exactly-once.
4. Integer arithmetic cho tiền, khớp công thức curve-engine.
5. Git: branch → merge `main`; không logo Claude / Co-Authored-By.
