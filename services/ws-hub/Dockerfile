# ── Build stage ───────────────────────────────────────────────────
FROM golang:1.22-alpine AS builder

WORKDIR /app

# Copy go.mod first; go.sum may not exist locally so we generate it here
COPY go.mod ./
# GONOSUMDB=* skips checksum DB lookup (fine for private/new modules)
RUN GONOSUMDB=* go mod tidy

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o ws-hub .

# ── Runtime stage ─────────────────────────────────────────────────
FROM gcr.io/distroless/static-debian12

WORKDIR /app
COPY --from=builder /app/ws-hub .

EXPOSE 8080

ENTRYPOINT ["/app/ws-hub"]
