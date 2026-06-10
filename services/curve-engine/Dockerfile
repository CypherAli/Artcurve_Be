FROM rust:1-alpine AS builder

# protoc cho tonic/prost codegen; musl-dev cho linker.
# Alpine (apk) thay Debian (apt) — ổn định hơn trong Docker build.
RUN apk add --no-cache musl-dev protobuf-dev protoc

WORKDIR /app

# Cache dependency layer — build a dummy binary first so cargo downloads deps once
COPY Cargo.toml build.rs ./
COPY proto/ proto/
RUN mkdir -p src && echo "fn main(){}" > src/main.rs \
  && cargo build --release 2>/dev/null; true

# Build real binary
COPY src/ src/
RUN touch src/main.rs && cargo build --release

# ── Runtime stage ─────────────────────────────────────────────────
# Binary musl static (mặc định của rust alpine target) → distroless/static
FROM gcr.io/distroless/static-debian12
WORKDIR /app
COPY --from=builder /app/target/release/curve-engine .

ENV GRPC_PORT=50051
EXPOSE 50051

ENTRYPOINT ["/app/curve-engine"]
