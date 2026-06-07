// src/curve/exponential.rs
//
// EXPONENTIAL bonding curve
//   Price:  P(s) = P0 × e^(k × s)
//   Integral:
//     ∫ P(s) ds = P0/k × (e^(k×b) - e^(k×a))
//
// Note: rust_decimal doesn't support exp() natively.
// We use f64 for the exponential part then convert back to Decimal.
// Precision loss is < 1e-12 — acceptable for ETH amounts.

use rust_decimal::Decimal;
use rust_decimal::prelude::ToPrimitive;
use super::{CurveConfig, CurveError};

pub fn spot_price(cfg: &CurveConfig, supply: Decimal) -> Result<Decimal, CurveError> {
    let p0 = cfg.init_price.to_f64().ok_or(CurveError::Overflow)?;
    let k  = cfg.slope.to_f64().ok_or(CurveError::Overflow)?;
    let s  = supply.to_f64().ok_or(CurveError::Overflow)?;

    let price = p0 * (k * s).exp();
    Decimal::try_from(price).map_err(|_| CurveError::Overflow)
}

pub fn integral(cfg: &CurveConfig, from: Decimal, to: Decimal) -> Result<Decimal, CurveError> {
    let p0 = cfg.init_price.to_f64().ok_or(CurveError::Overflow)?;
    let k  = cfg.slope.to_f64().ok_or(CurveError::Overflow)?;
    let a  = from.to_f64().ok_or(CurveError::Overflow)?;
    let b  = to.to_f64().ok_or(CurveError::Overflow)?;

    if k.abs() < 1e-15 {
        // k ≈ 0 → degenerate to flat price (edge case)
        let result = p0 * (b - a);
        return Decimal::try_from(result).map_err(|_| CurveError::Overflow);
    }

    // P0/k * (e^(k*b) - e^(k*a))
    let result = (p0 / k) * ((k * b).exp() - (k * a).exp());
    Decimal::try_from(result).map_err(|_| CurveError::Overflow)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rust_decimal_macros::dec;

    fn cfg() -> super::super::CurveConfig {
        super::super::CurveConfig {
            curve_type:   super::super::CurveKind::Exponential,
            init_price:   dec!(0.001),
            slope:        dec!(0.0002),   // e^(0.0002 * 20000) ≈ e^4 ≈ 54× price growth
            total_supply: dec!(20000),
        }
    }

    #[test]
    fn price_at_zero_is_init() {
        let p = spot_price(&cfg(), Decimal::ZERO).unwrap();
        // e^0 = 1, so P(0) = P0 = 0.001
        let diff = (p - dec!(0.001)).abs();
        assert!(diff < dec!(0.000001), "expected ~0.001, got {p}");
    }

    #[test]
    fn price_grows_faster_than_linear() {
        let cfg = cfg();
        let p_mid = spot_price(&cfg, dec!(10000)).unwrap();
        let p_end = spot_price(&cfg, dec!(20000)).unwrap();
        // exponential: price at end should be >> 2× price at mid
        assert!(p_end > p_mid * dec!(2));
    }
}
