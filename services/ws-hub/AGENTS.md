# AGENTS.md — artcurve-ws-hub

WebSocket hub real-time (Go 1.22 · gorilla/websocket · go-redis).
Nhận giá từ Redis pub/sub (do `Artcurve_Be` publish) → broadcast tới hàng nghìn client FE.
Chi tiết tích hợp với NestJS: xem `INTEGRATION.md`.

## Lệnh

```bash
go run .                     # env qua .env (godotenv): REDIS_URL, PORT
go test ./...                # PHẢI xanh trước khi merge
go build
docker build -t artcurve-ws-hub .
```

## Cấu trúc

```
main.go            # bootstrap
hub/hub.go         # hub quản lý client + broadcast
hub/client.go      # per-connection read/write pump
redis/subscriber.go # subscribe Redis channels
```

## Quy tắc bắt buộc

1. **Tên Redis channel là contract** với `Artcurve_Be`:
   `artwork:price:updated`, `artwork:graduated` — đổi phải sửa cả hai phía.
2. Hub chỉ fan-out message — KHÔNG chứa business logic, không gọi DB.
3. Mọi map client phải thao tác qua hub goroutine/mutex — tránh data race
   (chạy `go test -race ./...` khi sửa hub).
4. Git: branch → merge `main`; không logo Claude / Co-Authored-By.
