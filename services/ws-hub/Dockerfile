# ── Build stage ───────────────────────────────────────────────────
FROM golang:1.22-alpine AS builder

WORKDIR /app

# Chuẩn Go Docker: copy go.mod + go.sum trước để cache layer dependencies
COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o ws-hub .

# ── Runtime stage ─────────────────────────────────────────────────
FROM gcr.io/distroless/static-debian12

WORKDIR /app
COPY --from=builder /app/ws-hub .

EXPOSE 8080

ENTRYPOINT ["/app/ws-hub"]
