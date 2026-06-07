// src/book/order.rs — Order and Match types

use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

// ── Order side ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Side {
    Buy,
    Sell,
}

// ── Order type ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OrderType {
    /// Execute at market price (bonding curve spot price)
    Market,
    /// Execute only at limit_price or better
    Limit,
}

// ── Order status ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OrderStatus {
    Open,
    PartiallyFilled,
    Filled,
    Cancelled,
    Rejected,
}

// ── Incoming order (from RabbitMQ / NestJS) ───────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IncomingOrder {
    /// Unique ID assigned by NestJS (UUID v4)
    pub order_id:    Uuid,
    /// Artwork token being traded
    pub artwork_id:  Uuid,
    /// Wallet address of the trader
    pub user_wallet: String,
    pub side:        Side,
    pub order_type:  OrderType,
    /// Number of tokens to buy/sell
    pub amount:      Decimal,
    /// Only used for Limit orders (ETH per token)
    pub limit_price: Option<Decimal>,
    /// Max ETH willing to spend (slippage control for Market buy)
    pub max_eth:     Option<Decimal>,
    /// Min ETH expected to receive (slippage control for Market sell)
    pub min_eth:     Option<Decimal>,
    pub created_at:  DateTime<Utc>,
}

// ── Internal order (in the order book) ───────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Order {
    pub order_id:         Uuid,
    pub artwork_id:       Uuid,
    pub user_wallet:      String,
    pub side:             Side,
    pub order_type:       OrderType,
    pub status:           OrderStatus,
    pub original_amount:  Decimal,
    pub remaining_amount: Decimal,
    pub limit_price:      Option<Decimal>,
    pub max_eth:          Option<Decimal>,
    pub min_eth:          Option<Decimal>,
    pub created_at:       DateTime<Utc>,
    pub updated_at:       DateTime<Utc>,
}

impl Order {
    pub fn from_incoming(inc: IncomingOrder) -> Self {
        let now = Utc::now();
        Order {
            order_id:         inc.order_id,
            artwork_id:       inc.artwork_id,
            user_wallet:      inc.user_wallet,
            side:             inc.side,
            order_type:       inc.order_type,
            status:           OrderStatus::Open,
            original_amount:  inc.amount,
            remaining_amount: inc.amount,
            limit_price:      inc.limit_price,
            max_eth:          inc.max_eth,
            min_eth:          inc.min_eth,
            created_at:       inc.created_at,
            updated_at:       now,
        }
    }

    pub fn is_filled(&self) -> bool {
        self.remaining_amount.is_zero()
    }
}

// ── Match result (sent back to NestJS) ───────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MatchResult {
    pub match_id:        Uuid,
    pub order_id:        Uuid,
    pub artwork_id:      Uuid,
    pub user_wallet:     String,
    pub side:            Side,
    /// Tokens actually filled
    pub filled_amount:   Decimal,
    /// ETH paid (buy) or received (sell)
    pub eth_amount:      Decimal,
    /// Average ETH per token
    pub avg_price:       Decimal,
    /// Spot price after this match
    pub new_spot_price:  Decimal,
    /// Token supply after this match
    pub new_supply:      Decimal,
    pub status:          OrderStatus,
    /// Whether this trade triggers graduation
    pub would_graduate:  bool,
    pub matched_at:      DateTime<Utc>,
}

// ── Rejection event ───────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrderRejected {
    pub order_id:   Uuid,
    pub artwork_id: Uuid,
    pub reason:     String,
    pub at:         DateTime<Utc>,
}
