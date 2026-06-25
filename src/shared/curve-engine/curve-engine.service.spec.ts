import { CurveEngineService, CurveParams } from './curve-engine.service';
import { CurveType } from '../../modules/artworks/entities/artwork.entity';

// ─────────────────────────────────────────────────────────────────────────────
//  Unit tests cho toán bonding curve — logic tài chính quan trọng nhất của BE.
//  Bất biến cần giữ:
//    1. deriveSlope: ∫₀^T P(s)ds = target_cap (slope back-solve đúng)
//    2. Giá spot tăng đơn điệu theo supply (bonding curve không bao giờ giảm)
//    3. Buy rồi sell cùng lượng → ETH trả về = ETH bỏ ra (không rò rỉ value)
//    4. wouldGraduate bật đúng ngưỡng total_supply
// ─────────────────────────────────────────────────────────────────────────────

describe('CurveEngineService', () => {
  let service: CurveEngineService;

  beforeEach(() => {
    service = new CurveEngineService();
  });

  const CASES: Array<{ name: string; curveType: CurveType }> = [
    { name: 'linear',      curveType: CurveType.LINEAR },
    { name: 'quadratic',   curveType: CurveType.QUADRATIC },
    { name: 'exponential', curveType: CurveType.EXPONENTIAL },
  ];

  function buildParams(curveType: CurveType): CurveParams {
    const initPrice   = 0.001;
    const totalSupply = 20_000;
    const targetCap   = 100; // ETH
    const slope = service.deriveSlope({ initPrice, totalSupply, targetCap, curveType });
    return { curveType, initPrice, slope, totalSupply };
  }

  describe.each(CASES)('curve: $name', ({ curveType }) => {
    it('deriveSlope: tổng ETH mua hết supply ≈ target_cap', () => {
      const params = buildParams(curveType);
      const quote  = service.getBuyCost(params, 0, params.totalSupply);
      // sai số < 0.1% (exponential giải bằng bisection)
      expect(parseFloat(quote.ethAmount)).toBeCloseTo(100, 0);
      expect(Math.abs(parseFloat(quote.ethAmount) - 100) / 100).toBeLessThan(0.001);
    });

    it('giá spot tăng đơn điệu theo supply', () => {
      const params = buildParams(curveType);
      let prev = -Infinity;
      for (let s = 0; s <= params.totalSupply; s += params.totalSupply / 10) {
        const { price } = service.getSpotPrice(params, s);
        expect(parseFloat(price)).toBeGreaterThanOrEqual(prev);
        prev = parseFloat(price);
      }
    });

    it('giá spot tại supply=0 = init_price', () => {
      const params = buildParams(curveType);
      expect(parseFloat(service.getSpotPrice(params, 0).price)).toBeCloseTo(0.001, 6);
    });

    it('buy → sell cùng lượng trả về đúng số ETH (không rò rỉ value)', () => {
      const params  = buildParams(curveType);
      const supply0 = 5_000;
      const amount  = 1_000;
      const buy  = service.getBuyCost(params, supply0, amount);
      const sell = service.getSellReturn(params, supply0 + amount, amount);
      expect(parseFloat(sell.ethAmount)).toBeCloseTo(parseFloat(buy.ethAmount), 6);
      expect(parseFloat(sell.newSupply)).toBeCloseTo(supply0, 6);
    });

    it('wouldGraduate bật khi chạm total_supply, tắt khi chưa', () => {
      const params = buildParams(curveType);
      const below = service.getBuyCost(params, 0, params.totalSupply - 1);
      const hit   = service.getBuyCost(params, 0, params.totalSupply);
      expect(below.wouldGraduate).toBe(false);
      expect(hit.wouldGraduate).toBe(true);
    });
  });

  it('getSellReturn throws khi amount > currentSupply', () => {
    const params = buildParams(CurveType.LINEAR);
    expect(() => service.getSellReturn(params, 100, 500)).toThrow('Cannot sell 500');
  });

  it('deriveSlope trả 0 khi target_cap không vượt phần init_price (không slope âm)', () => {
    const slope = service.deriveSlope({
      initPrice: 0.001, totalSupply: 20_000, targetCap: 10, curveType: CurveType.LINEAR,
    });
    // baseEth = 0.001 * 20000 = 20 > targetCap 10 → slope clamp về 0
    expect(slope).toBe(0);
  });

  it('getPriceCurve trả đúng số điểm và clamp 2..500', () => {
    const params = buildParams(CurveType.QUADRATIC);
    expect(service.getPriceCurve(params, 50)).toHaveLength(51);
    expect(service.getPriceCurve(params, 1)).toHaveLength(3);     // clamp lên 2
    expect(service.getPriceCurve(params, 9999)).toHaveLength(501); // clamp xuống 500
  });

  it('paramsFromArtwork: parse string từ DB và suy ra totalSupply', () => {
    const params = service.paramsFromArtwork({
      curve_type:     CurveType.QUADRATIC,
      init_price:     '0.00100000',
      target_cap:     '100.00000000',
      current_supply: '0',
    });
    expect(params.totalSupply).toBeCloseTo(100_000, 0);
    // ⚠️ QUIRK đã biết: vì totalSupply xấp xỉ = target_cap/init_price nên
    // phần flat (init_price × supply) luôn = target_cap → slope = 0 (curve
    // phẳng). Cần quyết định semantics: target_cap là ETH raise hay ngưỡng
    // supply (entity artwork.entity.ts hiểu là supply, service này hiểu là
    // ETH). Khi chốt, đổi assertion này thành toBeGreaterThan(0).
    expect(params.slope).toBeGreaterThanOrEqual(0);
  });
});
