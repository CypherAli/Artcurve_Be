// src/main.rs — ArtCurve Bonding Curve Engine (gRPC)
//
// Exposes CurveEngine gRPC service on :50051.
// NestJS calls this via @grpc/grpc-js for all price calculations.
//
// Env vars:
//   GRPC_PORT   default 50051
//   LOG_LEVEL   default "info" (trace|debug|info|warn|error)

mod curve;
mod server;

use std::env;
use tonic::transport::Server;
use tracing::info;
use tracing_subscriber::{fmt, EnvFilter};

use server::{CurveEngineService, proto::curve_engine_server::CurveEngineServer};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Logging
    let log_level = env::var("LOG_LEVEL").unwrap_or_else(|_| "info".to_string());
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::new(format!("artcurve_curve_engine={log_level}")))
        .init();

    let _ = dotenvy::dotenv();

    let port = env::var("GRPC_PORT").unwrap_or_else(|_| "50051".to_string());
    let addr = format!("0.0.0.0:{port}").parse()?;

    info!("artcurve curve-engine listening on {addr}");

    Server::builder()
        .add_service(CurveEngineServer::new(CurveEngineService))
        .serve(addr)
        .await?;

    Ok(())
}
