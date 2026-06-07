FROM rust:1.78-slim AS builder

# Install protobuf compiler (needed for tonic/prost code generation)
RUN apt-get update && apt-get install -y protobuf-compiler libprotobuf-dev && rm -rf /var/lib/apt/lists/*

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
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=builder /app/target/release/curve-engine .

ENV GRPC_PORT=50051
EXPOSE 50051

CMD ["./curve-engine"]
