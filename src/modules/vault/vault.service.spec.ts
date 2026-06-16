import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { VaultService } from './vault.service';
import { InfraClickHouseService } from '../../shared/clickhouse/clickhouse-infra.service';

// Test trọng tâm cho realized P&L theo average-cost basis (computeRealizedPnl).
// Đây là phần logic dễ sai nhất nên cần lock lại bằng test.
describe('VaultService — realized P&L (average-cost)', () => {
  let service: VaultService;
  let query: jest.Mock;
  let getOHLCVData: jest.Mock;

  beforeEach(async () => {
    query = jest.fn();
    getOHLCVData = jest.fn().mockResolvedValue([]);
    const moduleRef = await Test.createTestingModule({
      providers: [
        VaultService,
        { provide: DataSource, useValue: { query } },
        { provide: InfraClickHouseService, useValue: { getOHLCVData } },
      ],
    }).compile();
    service = moduleRef.get(VaultService);
  });

  const callCompute = (txs: unknown[]) => {
    query.mockResolvedValueOnce(txs);
    // computeRealizedPnl là private — gọi qua cast để test trực tiếp
    return (service as unknown as {
      computeRealizedPnl: (u: string) => Promise<{ toFixed: (n: number) => string }>;
    }).computeRealizedPnl('user-1');
  };

  it('mua 100@1 + mua 100@2, bán 100@1.8 → realized = 30 (avgCost 1.5)', async () => {
    const realized = await callCompute([
      { artwork_id: 'a', tx_type: 'BUY',  share_amount: '100', eth_amount: '100' },
      { artwork_id: 'a', tx_type: 'BUY',  share_amount: '100', eth_amount: '200' },
      { artwork_id: 'a', tx_type: 'SELL', share_amount: '100', eth_amount: '180' },
    ]);
    expect(realized.toFixed(8)).toBe('30.00000000');
  });

  it('chưa bán gì → realized = 0', async () => {
    const realized = await callCompute([
      { artwork_id: 'a', tx_type: 'BUY', share_amount: '50', eth_amount: '75' },
    ]);
    expect(realized.toFixed(8)).toBe('0.00000000');
  });

  it('bán toàn bộ với lãi → realized = lãi thực', async () => {
    const realized = await callCompute([
      { artwork_id: 'a', tx_type: 'BUY',  share_amount: '10', eth_amount: '10' },  // avgCost 1
      { artwork_id: 'a', tx_type: 'SELL', share_amount: '10', eth_amount: '25' },  // +15
    ]);
    expect(realized.toFixed(8)).toBe('15.00000000');
  });

  it('mỗi artwork tính cost basis độc lập', async () => {
    const realized = await callCompute([
      { artwork_id: 'a', tx_type: 'BUY',  share_amount: '10', eth_amount: '10' },
      { artwork_id: 'b', tx_type: 'BUY',  share_amount: '10', eth_amount: '50' },
      { artwork_id: 'a', tx_type: 'SELL', share_amount: '10', eth_amount: '20' }, // +10
      { artwork_id: 'b', tx_type: 'SELL', share_amount: '10', eth_amount: '40' }, // -10
    ]);
    expect(realized.toFixed(8)).toBe('0.00000000');
  });

  // ── getPerformance: định giá theo giá lịch sử (OHLCV) ──────────────────────
  describe('getPerformance (historical valuation)', () => {
    const todayIso = new Date().toISOString();

    it('value ngày cuối = shares × close lịch sử (10 × 3 = 30)', async () => {
      query
        .mockResolvedValueOnce([ // txs
          { artwork_id: 'a', tx_type: 'BUY', share_amount: '10', timestamp: '2020-01-01T00:00:00.000Z' },
        ])
        .mockResolvedValueOnce([{ id: 'a', current_price: '1' }]); // fallback prices
      getOHLCVData.mockResolvedValue([{ bucket: todayIso, open: '3', high: '3', low: '3', close: '3', volume: '0', trade_count: '0' }]);

      const points = await service.getPerformance('user-1', '7d');
      expect(points.length).toBeGreaterThan(0);
      expect(points[points.length - 1].value_eth).toBe('30.00000000');
    });

    it('không có OHLCV → fallback approximation dùng current value', async () => {
      query
        .mockResolvedValueOnce([ // txs
          { artwork_id: 'a', tx_type: 'BUY', share_amount: '10', timestamp: '2020-01-01T00:00:00.000Z' },
        ])
        .mockResolvedValueOnce([])                       // dailyFlows (approx)
        .mockResolvedValueOnce([{ total_value: '5' }]);  // current holdings value
      getOHLCVData.mockResolvedValue([]); // CH trống → fallback

      const points = await service.getPerformance('user-1', '7d');
      // không có flow → mọi ngày giữ nguyên current value
      expect(points[points.length - 1].value_eth).toBe('5.00000000');
    });

    it('user chưa giao dịch → chuỗi 0', async () => {
      query.mockResolvedValueOnce([]); // no txs
      const points = await service.getPerformance('user-1', '7d');
      expect(points.every(p => p.value_eth === '0.00000000')).toBe(true);
    });
  });
});
