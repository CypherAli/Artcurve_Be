// src/curve/mod.rs
// Bonding curve math — pure functions, no I/O, fully testable.
//
// All calculations use rust_decimal for exact decimal arithmetic.
// No f64 — avoids floating point rounding errors for financial values.
//
// Formula reference:
//   LINEAR:       P(s) = P0 + slope × s
//   QUADRATIC:    P(s) = P0 + slope × s²
//   EXPONENTIAL:  P(s) = P0 × e^(k × s)
//
// Cost to buy Δs tokens from supply s0 = ∫[s0 → s0+Δs] P(s) ds

pub mod linear;
pub mod quadratic;
pub mod exponential;

use rust_decimal::Decimal;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum CurveError {
    #[error("invalid decimal: {0}")]
    ParseError(#[from] rust_decimal::Error),
    #[error("amount must be > 0")]
    ZeroAmount,
    #[error("insufficient supply to sell {amount} (current: {supply})")]
    InsufficientSupply { amount: String, supply: String },
    #[error("mathematical overflow")]
    Overflow,
}

/// Parsed, validated curve parameters
#[derive(Debug, Clone)]
pub struct CurveConfig {
    pub curve_type:   CurveKind,
    pub init_price:   Decimal,   // P0 (ETH)
    pub slope:        Decimal,   // k or slope coefficient
    pub total_supply: Decimal,   // graduation threshold
}

#[derive(Debug, Clone, PartialEq)]
pub enum CurveKind {
    Linear,
    Quadratic,
    Exponential,
}

/// Result of a buy or sell calculation
#[derive(Debug, Clone)]
pub struct TradeResult {
    pub eth_amount:      Decimal, // total ETH cost (buy) or return (sell)
    pub price_per_token: Decimal, // average execution price
    pub new_supply:      Decimal, // supply after trade
    pub new_spot_price:  Decimal, // spot price after trade executes
    pub would_graduate:  bool,    // true if new_supply >= total_supply
}

impl CurveConfig {
    /// Spot price P(s) at given supply
    pub fn spot_price(&self, supply: Decimal) -> Result<Decimal, CurveError> {
        match self.curve_type {
            CurveKind::Linear      => linear::spot_price(self, supply),
            CurveKind::Quadratic   => quadratic::spot_price(self, supply),
            CurveKind::Exponential => exponential::spot_price(self, supply),
        }
    }

    /// ETH cost to buy `amount` tokens from `current_supply`
    pub fn buy_cost(&self, current_supply: Decimal, amount: Decimal) -> Result<TradeResult, CurveError> {
        if amount <= Decimal::ZERO {
            return Err(CurveError::ZeroAmount);
        }
        let eth = match self.curve_type {
            CurveKind::Linear      => linear::integral(self, current_supply, current_supply + amount),
            CurveKind::Quadratic   => quadratic::integral(self, current_supply, current_supply + amount),
            CurveKind::Exponential => exponential::integral(self, current_supply, current_supply + amount),
        }?;

        let new_supply     = current_supply + amount;
        let new_spot_price = self.spot_price(new_supply)?;
        let price_per_token = eth / amount;

        Ok(TradeResult {
            eth_amount: eth,
            price_per_token,
            new_supply,
            new_spot_price,
            would_graduate: new_supply >= self.total_supply,
        })
    }

    /// ETH returned from selling `amount` tokens from `current_supply`
    pub fn sell_return(&self, current_supply: Decimal, amount: Decimal) -> Result<TradeResult, CurveError> {
        if amount <= Decimal::ZERO {
            return Err(CurveError::ZeroAmount);
        }
        if amount > current_supply {
            return Err(CurveError::InsufficientSupply {
                amount:  amount.to_string(),
                supply:  current_supply.to_string(),
            });
        }

        let new_supply = current_supply - amount;
        let eth = match self.curve_type {
            CurveKind::Linear      => linear::integral(self, new_supply, current_supply),
            CurveKind::Quadratic   => quadratic::integral(self, new_supply, current_supply),
            CurveKind::Exponential => exponential::integral(self, new_supply, current_supply),
        }?;

        let new_spot_price  = self.spot_price(new_supply)?;
        let price_per_token = eth / amount;

        Ok(TradeResult {
            eth_amount: eth,
            price_per_token,
            new_supply,
            new_spot_price,
            would_graduate: false,
        })
    }

    /// Market cap at given supply
    pub fn market_cap(&self, supply: Decimal) -> Result<Decimal, CurveError> {
        let price = self.spot_price(supply)?;
        Ok(price * supply)
    }

    /// Progress toward graduation (0.0 – 100.0)
    pub fn progress_pct(&self, supply: Decimal) -> Decimal {
        if self.total_supply.is_zero() {
            return Decimal::ZERO;
        }
        (supply / self.total_supply * Decimal::ONE_HUNDRED)
            .min(Decimal::ONE_HUNDRED)
    }
}
