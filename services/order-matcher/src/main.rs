// src/main.rs — ArtCurve Order Matching Engine (Rust)
//
// Flow:
//   NestJS → RabbitMQ "artcurve.orders"
//     → Rust matcher (process against bonding curve book)
//       → RabbitMQ "artcurve.matches"  → NestJS (settle in PostgreSQL)
//       → RabbitMQ "artcurve.rejects"  → NestJS (notify user of rejection)
//
// Env vars:
//   AMQP_URL      default amqp://guest:guest@localhost:5672
//   LOG_LEVEL     default info

mod book;
mod amqp;

use std::sync::Arc;
use std::time::Duration;

use lapin::{Connection, ConnectionProperties};
use tracing::{error, info};
use tracing_subscriber::EnvFilter;

use book::BookRegistry;
use amqp::producer::Publisher;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Logging
    let _ = dotenvy::dotenv();
    let log_level = std::env::var("LOG_LEVEL").unwrap_or_else(|_| "info".to_string());

    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::new(format!(
            "artcurve_order_matcher={log_level},lapin=warn"
        )))
        .json()
        .init();

    let amqp_url = std::env::var("AMQP_URL")
        .unwrap_or_else(|_| "amqp://guest:guest@localhost:5672".to_string());

    let registry = Arc::new(BookRegistry::new());

    // ── Connect with retry ────────────────────────────────────────────────────
    loop {
        info!("connecting to RabbitMQ at {amqp_url}");

        match connect_and_run(&amqp_url, registry.clone()).await {
            Ok(_) => {
                info!("consumer exited cleanly");
                break;
            }
            Err(e) => {
                error!("connection failed: {e} — retrying in 5s");
                tokio::time::sleep(Duration::from_secs(5)).await;
            }
        }
    }

    Ok(())
}

async fn connect_and_run(url: &str, registry: Arc<BookRegistry>) -> anyhow::Result<()> {
    let conn = Connection::connect(url, ConnectionProperties::default()).await?;
    info!("RabbitMQ connected");

    // Two channels: one for consuming, one for publishing
    let consume_ch = conn.create_channel().await?;
    let publish_ch = conn.create_channel().await?;

    let publisher = Arc::new(Publisher::new(publish_ch));

    amqp::consumer::start(consume_ch, registry, publisher).await?;

    Ok(())
}
