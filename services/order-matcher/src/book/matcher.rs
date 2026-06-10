// src/book/matcher.rs
//
// Core matching engine for ArtCurve bonding curve AMM.
//
// For a bonding curve DEX (like pump.fun), there's no counter-party.
// Every trade executes against the curve reserve.
//
// Order book manages:
//   Market orders  → execute immediately against curve price
//   Limit orders   → queue in BTreeMap, fill when spot price reaches limit
//
// Book state per artwork_id:
//   current_supply: Decimal     → updated after each fill
//   bids: BTreeMap<Price, VecDeque<Order>>   → buy limits (descending price)
//   asks: BTreeMap<Price, VecDeque<Order>>   → sell limits (ascending price)

use std::collections::{BTreeMap, VecDeque};

use chrono::Utc;
use rust_decimal::Decimal;
use rust_decimal_macros::dec;
use uuid::Uuid;

use super::order::{MatchResult, Order, OrderRejected, OrderStatus, OrderType, Side};

// ── Curve price function (simplified inline for matcher) ─────────────────────
// The matcher holds a snapshot of the curve params for this artwork.
// Full precision calculations are in artcurve-curve-engine.

#[derive(Debug, Clone)]
pub struct CurveSnapshot {
    pub init_price:   Decimal,
    pub slope:        Decimal,
    pub curve_type:   CurveKind,
    pub total_supply: Decimal,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum CurveKind { Linear, Quadratic, Exponential }

impl CurveSnapshot {
    fn spot_price(&self, supply: Decimal) -> Decimal {
        match self.curve_type {
            CurveKind::Linear      => self.init_price + self.slope * supply,
            CurveKind::Quadratic   => self.init_price + self.slope * supply * supply,
            CurveKind::Exponential => {
                // fast-path f64 for exponential
                let p0 = self.init_price.to_string().parse::<f64>().unwrap_or(0.001);
                let k  = self.slope.to_string().parse::<f64>().unwrap_or(0.0002);
                let s  = supply.to_string().parse::<f64>().unwrap_or(0.0);
                Decimal::try_from(p0 * (k * s).exp()).unwrap_or(self.init_price)
            }
        }
    }

    /// ETH cost to buy `amount` tokens from `from_supply`
    fn buy_cost(&self, from_supply: Decimal, amount: Decimal) -> Decimal {
        let to = from_supply + amount;
        match self.curve_type {
            CurveKind::Linear => {
                self.init_price * amount
                    + self.slope / dec!(2) * (to * to - from_supply * from_supply)
            }
            CurveKind::Quadratic => {
                self.init_price * amount
                    + self.slope / dec!(3) * (to * to * to - from_supply * from_supply * from_supply)
            }
            CurveKind::Exponential => {
                let p0 = self.init_price.to_string().parse::<f64>().unwrap_or(0.001);
                let k  = self.slope.to_string().parse::<f64>().unwrap_or(0.0002);
                let a  = from_supply.to_string().parse::<f64>().unwrap_or(0.0);
                let b  = to.to_string().parse::<f64>().unwrap_or(0.0);
                if k.abs() < 1e-15 { return self.init_price * amount; }
                let cost = (p0 / k) * ((k * b).exp() - (k * a).exp());
                Decimal::try_from(cost).unwrap_or(Decimal::ZERO)
            }
        }
    }
}

// ── Per-artwork order book ────────────────────────────────────────────────────
// Price key: Decimal scale về 8 chữ số thập phân → i128 (BTreeMap-orderable,
// không mất precision như đi vòng qua f64)

type PriceKey = i128;

fn to_key(d: Decimal) -> PriceKey {
    use rust_decimal::prelude::ToPrimitive;
    (d * Decimal::from(100_000_000u64)).trunc().to_i128().unwrap_or(0)
}

pub struct ArtworkBookV2 {
    pub artwork_id:     Uuid,
    pub current_supply: Decimal,
    pub curve:          CurveSnapshot,
    // bids: highest price first (reverse order for BTreeMap → negate key)
    bids: BTreeMap<std::cmp::Reverse<PriceKey>, VecDeque<Order>>,
    // asks: lowest price first
    asks: BTreeMap<PriceKey, VecDeque<Order>>,
}

impl ArtworkBookV2 {
    pub fn new(artwork_id: Uuid, current_supply: Decimal, curve: CurveSnapshot) -> Self {
        ArtworkBookV2 {
            artwork_id,
            current_supply,
            curve,
            bids: BTreeMap::new(),
            asks: BTreeMap::new(),
        }
    }

    pub fn spot_price(&self) -> Decimal {
        self.curve.spot_price(self.current_supply)
    }

    /// Process an incoming order. Returns a MatchResult or rejection.
    pub fn process(
        &mut self,
        order: Order,
    ) -> Result<MatchResult, OrderRejected> {
        match (order.order_type, order.side) {
            (OrderType::Market, Side::Buy)  => self.fill_market_buy(order),
            (OrderType::Market, Side::Sell) => self.fill_market_sell(order),
            (OrderType::Limit,  Side::Buy)  => self.add_limit_bid(order),
            (OrderType::Limit,  Side::Sell) => self.add_limit_ask(order),
        }
    }

    // ── Market Buy ──────────────────────────────────────────────────────────

    fn fill_market_buy(&mut self, order: Order) -> Result<MatchResult, OrderRejected> {
        let amount  = order.remaining_amount;
        let eth_cost = self.curve.buy_cost(self.current_supply, amount);

        // Slippage check
        if let Some(max_eth) = order.max_eth {
            if eth_cost > max_eth {
                return Err(OrderRejected {
                    order_id:   order.order_id,
                    artwork_id: order.artwork_id,
                    reason:     format!(
                        "slippage: cost {eth_cost:.8} ETH exceeds max_eth {max_eth:.8}"
                    ),
                    at: Utc::now(),
                });
            }
        }

        let new_supply    = self.current_supply + amount;
        let new_spot      = self.curve.spot_price(new_supply);
        let would_grad    = new_supply >= self.curve.total_supply;

        self.current_supply = new_supply;

        // After buy, check if any limit asks can now fill
        self.try_fill_asks();

        Ok(MatchResult {
            match_id:       Uuid::new_v4(),
            order_id:       order.order_id,
            artwork_id:     order.artwork_id,
            user_wallet:    order.user_wallet,
            side:           Side::Buy,
            filled_amount:  amount,
            eth_amount:     eth_cost,
            avg_price:      if amount.is_zero() { Decimal::ZERO } else { eth_cost / amount },
            new_spot_price: new_spot,
            new_supply,
            status:         OrderStatus::Filled,
            would_graduate: would_grad,
            matched_at:     Utc::now(),
        })
    }

    // ── Market Sell ─────────────────────────────────────────────────────────

    fn fill_market_sell(&mut self, order: Order) -> Result<MatchResult, OrderRejected> {
        let amount = order.remaining_amount;

        if amount > self.current_supply {
            return Err(OrderRejected {
                order_id:   order.order_id,
                artwork_id: order.artwork_id,
                reason:     format!(
                    "insufficient supply: sell {amount} but supply is {}", self.current_supply
                ),
                at: Utc::now(),
            });
        }

        let new_supply = self.current_supply - amount;
        let eth_return = self.curve.buy_cost(new_supply, amount); // same integral

        // Slippage check
        if let Some(min_eth) = order.min_eth {
            if eth_return < min_eth {
                return Err(OrderRejected {
                    order_id:   order.order_id,
                    artwork_id: order.artwork_id,
                    reason:     format!(
                        "slippage: return {eth_return:.8} ETH below min_eth {min_eth:.8}"
                    ),
                    at: Utc::now(),
                });
            }
        }

        let new_spot = self.curve.spot_price(new_supply);
        self.current_supply = new_supply;

        // After sell, check if limit bids can now fill
        self.try_fill_bids();

        Ok(MatchResult {
            match_id:       Uuid::new_v4(),
            order_id:       order.order_id,
            artwork_id:     order.artwork_id,
            user_wallet:    order.user_wallet,
            side:           Side::Sell,
            filled_amount:  amount,
            eth_amount:     eth_return,
            avg_price:      if amount.is_zero() { Decimal::ZERO } else { eth_return / amount },
            new_spot_price: new_spot,
            new_supply,
            status:         OrderStatus::Filled,
            would_graduate: false,
            matched_at:     Utc::now(),
        })
    }

    // ── Limit orders ─────────────────────────────────────────────────────────

    fn add_limit_bid(&mut self, order: Order) -> Result<MatchResult, OrderRejected> {
        let limit = order.limit_price.unwrap_or(Decimal::ZERO);
        let spot  = self.spot_price();

        if limit >= spot {
            // Immediately fillable — treat as market
            return self.fill_market_buy(order);
        }

        // Queue at limit price
        let key = std::cmp::Reverse(to_key(limit));
        self.bids.entry(key).or_default().push_back(order.clone());

        // Return "queued" result — NestJS will track order_id
        Ok(MatchResult {
            match_id:       Uuid::new_v4(),
            order_id:       order.order_id,
            artwork_id:     order.artwork_id,
            user_wallet:    order.user_wallet,
            side:           Side::Buy,
            filled_amount:  Decimal::ZERO,
            eth_amount:     Decimal::ZERO,
            avg_price:      Decimal::ZERO,
            new_spot_price: spot,
            new_supply:     self.current_supply,
            status:         OrderStatus::Open,
            would_graduate: false,
            matched_at:     Utc::now(),
        })
    }

    fn add_limit_ask(&mut self, order: Order) -> Result<MatchResult, OrderRejected> {
        let limit = order.limit_price.unwrap_or(Decimal::MAX);
        let spot  = self.spot_price();

        if limit <= spot {
            // Immediately fillable
            return self.fill_market_sell(order);
        }

        let key = to_key(limit);
        self.asks.entry(key).or_default().push_back(order.clone());

        Ok(MatchResult {
            match_id:       Uuid::new_v4(),
            order_id:       order.order_id,
            artwork_id:     order.artwork_id,
            user_wallet:    order.user_wallet,
            side:           Side::Sell,
            filled_amount:  Decimal::ZERO,
            eth_amount:     Decimal::ZERO,
            avg_price:      Decimal::ZERO,
            new_spot_price: spot,
            new_supply:     self.current_supply,
            status:         OrderStatus::Open,
            would_graduate: false,
            matched_at:     Utc::now(),
        })
    }

    // ── Limit order fill sweeps ───────────────────────────────────────────────

    /// After a buy pushed price up, fill limit asks whose price ≤ new spot
    fn try_fill_asks(&mut self) {
        let spot_key = to_key(self.spot_price());
        // Collect keys to fill
        let fillable: Vec<PriceKey> = self.asks
            .range(..=spot_key)
            .map(|(k, _)| *k)
            .collect();

        for key in fillable {
            // remove() lấy ownership queue trước — tránh giữ &mut self.asks
            // trong khi fill_market_sell cần &mut self (E0499)
            if let Some(mut queue) = self.asks.remove(&key) {
                while let Some(order) = queue.pop_front() {
                    // Best-effort fill — ignore result for now
                    let _ = self.fill_market_sell(order);
                }
            }
        }
    }

    /// After a sell pushed price down, fill limit bids whose price ≥ new spot
    fn try_fill_bids(&mut self) {
        let spot_key = to_key(self.spot_price());
        let fillable: Vec<std::cmp::Reverse<PriceKey>> = self.bids
            .range(std::cmp::Reverse(PriceKey::MAX)..=std::cmp::Reverse(spot_key))
            .map(|(k, _)| *k)
            .collect();

        for key in fillable {
            if let Some(mut queue) = self.bids.remove(&key) {
                while let Some(order) = queue.pop_front() {
                    let _ = self.fill_market_buy(order);
                }
            }
        }
    }
}
