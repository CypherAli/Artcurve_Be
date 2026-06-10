FROM rust:1-alpine AS builder
RUN apk add --no-cache musl-dev

WORKDIR /app
COPY Cargo.toml ./
# Cache dependencies
RUN mkdir src && echo "fn main(){}" > src/main.rs && cargo build --release 2>/dev/null; rm -rf src

COPY src ./src
RUN touch src/main.rs && cargo build --release

# ── Runtime ───────────────────────────────────────────────────────
FROM gcr.io/distroless/static-debian12
COPY --from=builder /app/target/release/order-matcher /app/order-matcher
ENTRYPOINT ["/app/order-matcher"]
