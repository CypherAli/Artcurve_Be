# PROJECT.md — artcurve-ws-hub (Real-time Hub)

> WebSocket fan-out hub — Go 1.22 · gorilla/websocket · go-redis · zerolog.

## 1. Vai trò

Đẩy giá real-time tới trình duyệt. Khi giá artwork đổi (sau mỗi giao dịch on-chain),
NestJS publish lên Redis; hub này subscribe và broadcast tới **mọi client đang mở
trang trade/marketplace** — giá nhảy tức thì, không cần reload.

## 2. Vì sao tách khỏi NestJS?

- Node.js single-thread đuối khi giữ hàng nghìn WebSocket connection đồng thời.
- Go goroutines: mỗi connection ~vài KB, chịu tải chục nghìn client trên 1 instance rẻ.
- NestJS giữ nguyên business logic — hub CHỈ fan-out, zero logic (xem `INTEGRATION.md`).

## 3. Luồng dữ liệu

```
Giao dịch on-chain → Artcurve_Be (blockchain module)
    → RedisService.publishPriceUpdate()
        → Redis channel "artwork:price:updated" / "artwork:graduated"
            → ws-hub subscriber (redis/subscriber.go)
                → hub.Broadcast (hub/hub.go)
                    → hàng nghìn client FE
```

## 4. Cấu trúc

```
main.go              # bootstrap, env (.env qua godotenv)
hub/hub.go           # registry client + broadcast loop
hub/client.go        # read/write pump mỗi connection (ping/pong, buffer)
hub/hub_test.go      # unit test
redis/subscriber.go  # Redis pub/sub consumer
INTEGRATION.md       # hướng dẫn nối với NestJS + FE
```

## 5. Trạng thái

✅ Hoàn chỉnh: hub, client pump, Redis subscriber, test, Dockerfile.
🔗 Contract với Be: tên channel Redis; với FE: URL WebSocket (`NEXT_PUBLIC_WS_HUB_URL`).
