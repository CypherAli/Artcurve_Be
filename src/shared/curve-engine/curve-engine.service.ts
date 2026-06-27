import { Injectable } from '@nestjs/common';
import { CurveType } from '../../modules/artworks/entities/artwork.entity';

// ── Types ────────────────────────────────────────────────────────────────────

export interface CurveParams {
  curveType:   CurveType;
  initPrice:   number;   // P0 — ETH per token at supply=0
  slope:       number;   // steepness coefficient (derived from target_cap)
  totalSupply: number;   // graduation threshold (tokens)
}

export interface QuoteResult {
  ethAmount:      string;   // ETH cost (buy) or ETH returned (sell)
  pricePerToken:  string;   // average price for this trade
  newSupply:      string;   // supply after trade
  newSpotPrice:   string;   // spot price after trade
  wouldGraduate:  boolean;
}

export interface SpotResult {
  price:     string;
  marketCap: string;
}

export interface PricePoint {
  supply: string;
  price:  string;
}

// ── Bonding Curve Math (mirrors Rust curve-engine logic) ─────────────────────
//
// LINEAR:      P(s) = P0 + slope * s
//   integral:  P0*Δs + slope/2 * (b²-a²)
//
// QUADRATIC:   P(s) = P0 + slope * s²
//   integral:  P0*Δs + slope/3 * (b³-a³)
//
// EXPONENTIAL: P(s) = P0 * e^(slope * s)
//   integral:  P0/slope * (e^(slope*b) - e^(slope*a))
//
// Slope is derived from target_cap (total ETH to raise) and total_supply
// so that ∫₀^T P(s)ds = target_cap.
// ────────────────────────────────────────────────────────────────────────────

@Injectable()
export class CurveEngineService {

  // ── Slope derivation ───────────────────────────────────────────────────────

  /**
   * Given init_price, total_supply, target_cap (ETH), and curve_type,
   * back-calculate slope so that the integral from 0 → T equals target_cap.
   */
  deriveSlope(p: { initPrice: number; totalSupply: number; targetCap: number; curveType: CurveType }): number {
    const { initPrice: P0, totalSupply: T, targetCap: C, curveType } = p;
    const baseEth = P0 * T;  // ETH raised by the flat init_price component

    if (T <= 0 || C <= 0) return 0;

    switch (curveType) {
      case CurveType.LINEAR:
        // ∫₀^T (P0 + slope*s) ds = P0*T + slope*T²/2 = C
        // slope = (C - P0*T) * 2 / T²
        return Math.max(0, (C - baseEth) * 2 / (T * T));

      case CurveType.QUADRATIC:
        // ∫₀^T (P0 + slope*s²) ds = P0*T + slope*T³/3 = C
        // slope = (C - P0*T) * 3 / T³
        return Math.max(0, (C - baseEth) * 3 / (T * T * T));

      case CurveType.EXPONENTIAL:
        // ∫₀^T P0*e^(k*s) ds = P0/k*(e^(kT)-1) = C
        // Solve numerically: f(k) = P0/k*(e^(kT)-1) - C = 0
        return this.solveExponentialSlope(P0, T, C);
    }
  }

  private solveExponentialSlope(P0: number, T: number, C: number): number {
    // Bisection method — converges in ~50 iterations
    let lo = 1e-10, hi = 10;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      const val = (P0 / mid) * (Math.exp(mid * T) - 1);
      if (val < C) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }

  // ── Core math ──────────────────────────────────────────────────────────────

  spotPrice(params: CurveParams, supply: number): number {
    const { initPrice: P0, slope, curveType } = params;
    switch (curveType) {
      case CurveType.LINEAR:      return P0 + slope * supply;
      case CurveType.QUADRATIC:   return P0 + slope * supply * supply;
      case CurveType.EXPONENTIAL: return P0 * Math.exp(slope * supply);
    }
  }

  private integral(params: CurveParams, from: number, to: number): number {
    const { initPrice: P0, slope, curveType } = params;
    const delta = to - from;
    switch (curveType) {
      case CurveType.LINEAR:
        return P0 * delta + (slope / 2) * (to * to - from * from);
      case CurveType.QUADRATIC:
        return P0 * delta + (slope / 3) * (to * to * to - from * from * from);
      case CurveType.EXPONENTIAL:
        if (Math.abs(slope) < 1e-15) return P0 * delta;
        return (P0 / slope) * (Math.exp(slope * to) - Math.exp(slope * from));
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  getSpotPrice(params: CurveParams, currentSupply: number): SpotResult {
    const price     = this.spotPrice(params, currentSupply);
    const marketCap = price * currentSupply;
    return {
      price:     price.toFixed(8),
      marketCap: marketCap.toFixed(8),
    };
  }

  getBuyCost(params: CurveParams, currentSupply: number, amount: number): QuoteResult {
    const newSupply   = currentSupply + amount;
    const ethAmount   = this.integral(params, currentSupply, newSupply);
    const avgPrice    = amount > 0 ? ethAmount / amount : 0;
    const newSpot     = this.spotPrice(params, newSupply);
    return {
      ethAmount:     ethAmount.toFixed(8),
      pricePerToken: avgPrice.toFixed(8),
      newSupply:     newSupply.toFixed(8),
      newSpotPrice:  newSpot.toFixed(8),
      wouldGraduate: newSupply >= params.totalSupply,
    };
  }

  getSellReturn(params: CurveParams, currentSupply: number, amount: number): QuoteResult {
    if (amount > currentSupply) {
      throw new Error(`Cannot sell ${amount} — only ${currentSupply} in supply`);
    }
    const newSupply  = currentSupply - amount;
    const ethAmount  = this.integral(params, newSupply, currentSupply);
    const avgPrice   = amount > 0 ? ethAmount / amount : 0;
    const newSpot    = this.spotPrice(params, newSupply);
    return {
      ethAmount:     ethAmount.toFixed(8),
      pricePerToken: avgPrice.toFixed(8),
      newSupply:     newSupply.toFixed(8),
      newSpotPrice:  newSpot.toFixed(8),
      wouldGraduate: false,
    };
  }

  getPriceCurve(params: CurveParams, points = 50): PricePoint[] {
    // Use constant product AMM formula matching on-chain BondingCurveAMM.sol
    // On-chain: price = X * PRECISION / Y where X,Y are virtual pool reserves
    // Initial state: X = initialVirtualETH (derived), Y = targetCap (totalSupply)
    // k = X * Y = constant
    // After selling `sold` shares: Y' = Y - sold, X' = k / Y' = X * Y / (Y - sold)
    // price = X' / Y' = k / Y'^2
    const T = params.totalSupply;
    const initialX = params.initPrice * T; // virtual ETH = init_price * totalSupply
    const k = initialX * T;
    const n = Math.min(Math.max(points, 2), 500);
    const result: PricePoint[] = [];
    for (let i = 0; i <= n; i++) {
      const sold = (i / n) * T;
      const Y = T - sold;
      const price = Y > 0 ? k / (Y * Y) : 0;
      result.push({
        supply: sold.toFixed(2),
        price:  price.toFixed(8),
      });
    }
    return result;
  }

  /** Original integral-based curve — kept for Studio preview (pre-deployment) */
  getTheoreticalPriceCurve(params: CurveParams, points = 50): PricePoint[] {
    const n = Math.min(Math.max(points, 2), 500);
    const result: PricePoint[] = [];
    for (let i = 0; i <= n; i++) {
      const s = (i / n) * params.totalSupply;
      result.push({
        supply: s.toFixed(2),
        price:  this.spotPrice(params, s).toFixed(8),
      });
    }
    return result;
  }

  // ── Helper: build CurveParams from DB artwork fields ──────────────────────

  paramsFromArtwork(artwork: {
    curve_type:   CurveType;
    init_price:   string;
    target_cap:   string;
    current_supply: string;
  }): CurveParams {
    const initPrice   = parseFloat(artwork.init_price)   || 0.001;
    const targetCap   = parseFloat(artwork.target_cap)   || 1;
    // total_supply is approximated as target_cap / init_price
    // (FE sends target_cap = supply * initPrice)
    const totalSupply = targetCap / initPrice;
    const slope = this.deriveSlope({
      initPrice,
      totalSupply,
      targetCap,
      curveType: artwork.curve_type,
    });
    return { curveType: artwork.curve_type, initPrice, slope, totalSupply };
  }
}
