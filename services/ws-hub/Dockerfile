# ── Build stage ───────────────────────────────────────────────────
FROM golang:1.22-alpine AS builder

WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o ws-hub .

# ── Runtime stage ─────────────────────────────────────────────────
# Distroless — no shell, minimal attack surface, ~5MB image
FROM gcr.io/distroless/static-debian12

WORKDIR /app
COPY --from=builder /app/ws-hub .

EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=5s --start-period=5s --retries=3 \
  CMD ["/app/ws-hub", "-health"]

ENTRYPOINT ["/app/ws-hub"]
