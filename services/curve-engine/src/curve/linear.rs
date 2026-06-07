// src/curve/linear.rs
//
// LINEAR bonding curve
//   Price:  P(s) = P0 + slope × s
//   Integral (area under curve from a → b):
//     ∫ P(s) ds = P0×(b-a) + slope/2 × (b² - a²)

use rust_decimal::Decimal;
use rust_decimal_macros::dec;
use super::{CurveConfig, CurveError};

pub fn spot_price(cfg: &CurveConfig, supply: Decimal) -> Result<Decimal, CurveError> {
    // P(s) = P0 + slope * s
    Ok(cfg.init_price + cfg.slope * supply)
}

pub fn integral(cfg: &CurveConfig, from: Decimal, to: Decimal) -> Result<Decimal, CurveError> {
    let delta = to - from;
    // P0 * Δs
    let linear_term = cfg.init_price * delta;
    // slope/2 * (to² - from²)
    let quad_term = cfg.slope / dec!(2) * (to * to - from * from);
    Ok(linear_term + quad_term)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rust_decimal_macros::dec;

    fn cfg() -> CurveConfig {
        super::super::CurveConfig {
            curve_type:   super::super::CurveKind::Linear,
            init_price:   dec!(0.001),   // 0.001 ETH
            slope:        dec!(0.0000001),
            total_supply: dec!(20000),
        }
    }

    #[test]
    fn price_at_zero_supply_is_init() {
        let p = spot_price(&cfg(), Decimal::ZERO).unwrap();
        assert_eq!(p, dec!(0.001));
    }

    #[test]
    fn price_increases_with_supply() {
        let cfg = cfg();
        let p0 = spot_price(&cfg, dec!(0)).unwrap();
        let p1 = spot_price(&cfg, dec!(10000)).unwrap();
        assert!(p1 > p0);
    }

    #[test]
    fn buy_1000_tokens_from_zero() {
        let eth = integral(&cfg(), dec!(0), dec!(1000)).unwrap();
        // Expected: 0.001*1000 + 0.0000001/2 * 1000000 = 1 + 0.05 = 1.05 ETH
        assert_eq!(eth, dec!(1.05));
    }
}
