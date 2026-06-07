// src/amqp/producer.rs
// Publishes match results and rejections back to RabbitMQ.
// NestJS consumes these to settle trades in PostgreSQL and notify users.

use lapin::{
    options::BasicPublishOptions,
    BasicProperties, Channel,
};
use tracing::debug;

use crate::book::order::{MatchResult, OrderRejected};
use super::consumer::{QUEUE_MATCHES, QUEUE_REJECTS};

pub struct Publisher {
    channel: Channel,
}

impl Publisher {
    pub fn new(channel: Channel) -> Self {
        Publisher { channel }
    }

    pub async fn publish_match(&self, result: &MatchResult) -> anyhow::Result<()> {
        let payload = serde_json::to_vec(result)?;
        self.publish(QUEUE_MATCHES, &payload).await?;
        debug!(order_id=%result.order_id, "published match");
        Ok(())
    }

    pub async fn publish_rejection(&self, rejection: &OrderRejected) -> anyhow::Result<()> {
        let payload = serde_json::to_vec(rejection)?;
        self.publish(QUEUE_REJECTS, &payload).await?;
        debug!(order_id=%rejection.order_id, "published rejection");
        Ok(())
    }

    async fn publish(&self, queue: &str, payload: &[u8]) -> anyhow::Result<()> {
        self.channel.basic_publish(
            "",     // default exchange → routes by queue name
            queue,
            BasicPublishOptions::default(),
            payload,
            BasicProperties::default()
                .with_content_type("application/json".into())
                .with_delivery_mode(2), // persistent
        ).await?.await?;
        Ok(())
    }
}
