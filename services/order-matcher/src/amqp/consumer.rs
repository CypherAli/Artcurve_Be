// src/amqp/consumer.rs
// Consumes orders from RabbitMQ queue "artcurve.orders"
//
// Message format (JSON):
// {
//   "order_id":    "uuid",
//   "artwork_id":  "uuid",
//   "user_wallet": "0x...",
//   "side":        "buy" | "sell",
//   "order_type":  "market" | "limit",
//   "amount":      "100",
//   "limit_price": "0.005",     // optional
//   "max_eth":     "0.6",       // optional, market buy slippage
//   "min_eth":     "0.45",      // optional, market sell slippage
//   "created_at":  "2024-...",
//   // Curve snapshot (NestJS sends current artwork state)
//   "curve": {
//     "init_price":   "0.001",
//     "slope":        "0.000000001",
//     "curve_type":   "quadratic",   // linear | quadratic | exponential
//     "total_supply": "20000",
//     "current_supply": "5234.5"
//   }
// }

use std::sync::Arc;

use lapin::{
    message::Delivery,
    options::{BasicAckOptions, BasicNackOptions, BasicConsumeOptions, QueueDeclareOptions},
    types::FieldTable,
    Channel,
};
use rust_decimal::Decimal;
use serde::Deserialize;
use tracing::{error, info, warn};
use uuid::Uuid;

use crate::book::{BookRegistry, matcher::{CurveKind, CurveSnapshot}};
use crate::book::order::IncomingOrder;
use super::producer::Publisher;

// ── Incoming JSON shape ───────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct OrderMessage {
    #[serde(flatten)]
    pub order: IncomingOrder,
    pub curve: CurveInfo,
}

#[derive(Debug, Deserialize)]
pub struct CurveInfo {
    pub init_price:      Decimal,
    pub slope:           Decimal,
    #[serde(default = "default_curve_type")]
    pub curve_type:      String,    // "linear" | "quadratic" | "exponential"
    pub total_supply:    Decimal,
    pub current_supply:  Decimal,
}

fn default_curve_type() -> String { "quadratic".to_string() }

impl CurveInfo {
    pub fn to_snapshot(&self) -> CurveSnapshot {
        let kind = match self.curve_type.as_str() {
            "linear"      => CurveKind::Linear,
            "exponential" => CurveKind::Exponential,
            _             => CurveKind::Quadratic,
        };
        CurveSnapshot {
            init_price:   self.init_price,
            slope:        self.slope,
            curve_type:   kind,
            total_supply: self.total_supply,
        }
    }
}

// ── Consumer ─────────────────────────────────────────────────────────────────

pub const QUEUE_ORDERS:  &str = "artcurve.orders";
pub const QUEUE_MATCHES: &str = "artcurve.matches";
pub const QUEUE_REJECTS: &str = "artcurve.rejects";

pub async fn start(
    channel: Channel,
    registry: Arc<BookRegistry>,
    publisher: Arc<Publisher>,
) -> anyhow::Result<()> {
    // Declare queues (idempotent — safe to call every startup)
    for queue in [QUEUE_ORDERS, QUEUE_MATCHES, QUEUE_REJECTS] {
        channel.queue_declare(
            queue,
            QueueDeclareOptions { durable: true, ..Default::default() },
            FieldTable::default(),
        ).await?;
    }

    let mut consumer = channel.basic_consume(
        QUEUE_ORDERS,
        "artcurve-order-matcher",
        BasicConsumeOptions::default(),
        FieldTable::default(),
    ).await?;

    info!("listening on queue '{QUEUE_ORDERS}'");

    use futures_lite::stream::StreamExt;
    while let Some(delivery) = consumer.next().await {
        match delivery {
            Ok(delivery) => {
                let reg  = registry.clone();
                let pub_ = publisher.clone();
                tokio::spawn(async move {
                    handle_delivery(delivery, reg, pub_).await;
                });
            }
            Err(e) => {
                error!("consumer error: {e}");
                break; // caller will reconnect
            }
        }
    }

    Ok(())
}

async fn handle_delivery(
    delivery: Delivery,
    registry: Arc<BookRegistry>,
    publisher: Arc<Publisher>,
) {
    let raw = match std::str::from_utf8(&delivery.data) {
        Ok(s) => s,
        Err(e) => {
            warn!("non-utf8 message: {e}");
            let _ = delivery.nack(BasicNackOptions { requeue: false, ..Default::default() }).await;
            return;
        }
    };

    let msg: OrderMessage = match serde_json::from_str(raw) {
        Ok(m) => m,
        Err(e) => {
            warn!("invalid order JSON: {e} — raw: {raw:.200}");
            let _ = delivery.nack(BasicNackOptions { requeue: false, ..Default::default() }).await;
            return;
        }
    };

    let artwork_id = msg.order.artwork_id;
    let snapshot   = msg.curve.to_snapshot();
    let supply     = msg.curve.current_supply;

    // Ensure book exists with current supply
    registry.ensure_book(artwork_id, snapshot.clone(), supply).await;

    match registry.process_order(msg.order, snapshot).await {
        Ok(result) => {
            info!(
                order_id=%result.order_id,
                side=?result.side,
                filled=%result.filled_amount,
                eth=%result.eth_amount,
                "order matched"
            );
            if let Err(e) = publisher.publish_match(&result).await {
                error!("failed to publish match: {e}");
            }
        }
        Err(rejection) => {
            warn!(order_id=%rejection.order_id, reason=%rejection.reason, "order rejected");
            if let Err(e) = publisher.publish_rejection(&rejection).await {
                error!("failed to publish rejection: {e}");
            }
        }
    }

    let _ = delivery.ack(BasicAckOptions::default()).await;
}
