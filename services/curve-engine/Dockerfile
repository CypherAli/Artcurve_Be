FROM rust:1.78-slim AS builder

# Install protobuf compiler (needed for tonic/prost code generation)
RUN apt-get update && apt-get install -y protobuf-compiler libprotobuf-dev && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY Cargo.toml build.rs ./
COPY proto/ proto/
COPY src/ src/

RUN cargo build --release

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=builder /app/target/release/artcurve-curve-engine .

ENV GRPC_PORT=50051
EXPOSE 50051

CMD ["./artcurve-curve-engine"]
