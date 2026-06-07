// src/curve/quadratic.rs
//
// QUADRATIC bonding curve (default for ArtCurve)
//   Price:  P(s) = P0 + slope × s²
//   Integral:
//     ∫ P(s) ds = P0×(b-a) + slope/3 × (b³ - a³)

use rust_decimal::Decimal;
use rust_decimal_macros::dec;
use super::{CurveConfig, CurveError};

pub fn spot_price(cfg: &CurveConfig, supply: Decimal) -> Result<Decimal, CurveError> {
    Ok(cfg.init_price + cfg.slope * supply * supply)
}

pub fn integral(cfg: &CurveConfig, from: Decimal, to: Decimal) -> Result<Decimal, CurveError> {
    let delta = to - from;
    let linear_term = cfg.init_price * delta;
    // slope/3 * (to³ - from³)
    let cubic_term = cfg.slope / dec!(3) * (to * to * to - from * from * from);
    Ok(linear_term + cubic_term)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rust_decimal_macros::dec;

    fn cfg() -> super::super::CurveConfig {
        super::super::CurveConfig {
            curve_type:   super::super::CurveKind::Quadratic,
            init_price:   dec!(0.001),
            slope:        dec!(0.000000001),  // very flat — grows slowly
            total_supply: dec!(20000),
        }
    }

    #[test]
    fn price_at_zero_is_init() {
        assert_eq!(spot_price(&cfg(), Decimal::ZERO).unwrap(), dec!(0.001));
    }

    #[test]
    fn price_at_graduation_supply() {
        // P(20000) = 0.001 + 0.000000001 * 400_000_000 = 0.001 + 0.4 = 0.401 ETH
        let p = spot_price(&cfg(), dec!(20000)).unwrap();
        assert_eq!(p, dec!(0.401));
    }

    #[test]
    fn buy_cost_is_positive() {
        let cost = integral(&cfg(), dec!(0), dec!(1000)).unwrap();
        assert!(cost > Decimal::ZERO);
    }

    #[test]
    fn sell_return_less_than_buy_cost() {
        // Sell at lower supply → lower price → less ETH returned
        let buy  = integral(&cfg(), dec!(0),    dec!(1000)).unwrap();
        let sell = integral(&cfg(), dec!(0),    dec!(1000)).unwrap();
        assert_eq!(buy, sell); // same range → same area (reversible AMM)
    }
}
