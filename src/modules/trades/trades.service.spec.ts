import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { TradesService } from './trades.service';
import { InfraClickHouseService } from '../../shared/clickhouse/clickhouse-infra.service';
import { TransactionRepository } from './repositories/transaction.repository';

describe('TradesService', () => {
  let service: TradesService;
  let chService: jest.Mocked<InfraClickHouseService>;
  let txRepo: jest.Mocked<TransactionRepository>;
  let dataSource: jest.Mocked<DataSource>;

  beforeEach(async () => {
    chService = {
      getOHLCVData: jest.fn().mockResolvedValue([]),
      getVolume24h: jest.fn().mockResolvedValue('0'),
      getTopByVolume: jest.fn().mockResolvedValue([]),
    } as any;

    txRepo = {
      findRecent: jest.fn().mockResolvedValue([]),
      findByArtwork: jest.fn().mockResolvedValue([]),
      findByUser: jest.fn().mockResolvedValue([]),
    } as any;

    dataSource = { query: jest.fn() } as any;

    const module = await Test.createTestingModule({
      providers: [
        TradesService,
        { provide: InfraClickHouseService, useValue: chService },
        { provide: TransactionRepository, useValue: txRepo },
        { provide: DataSource, useValue: dataSource },
        { provide: 'INFRA_REDIS_CLIENT', useValue: { get: jest.fn(), set: jest.fn(), del: jest.fn() } },
      ],
    }).compile();

    service = module.get(TradesService);
  });

  describe('getVolume24h', () => {
    it('should delegate to ClickHouse service', async () => {
      chService.getVolume24h.mockResolvedValue('123.456');
      const result = await service.getVolume24h('art-1');
      expect(result).toBe('123.456');
      expect(chService.getVolume24h).toHaveBeenCalledWith('art-1');
    });
  });

  describe('getTopByVolume', () => {
    it('should return top artworks by volume', async () => {
      const top = [{ artwork_id: 'a1', title: 'Top', volume_7d: '500' }];
      chService.getTopByVolume.mockResolvedValue(top as any);

      const result = await service.getTopByVolume(5);
      expect(result).toHaveLength(1);
      expect(chService.getTopByVolume).toHaveBeenCalledWith(5);
    });
  });

  describe('getRecentTrades', () => {
    it('should return recent trades capped at 50', async () => {
      txRepo.findRecent.mockResolvedValue([{ id: 't1' }] as any);

      const result = await service.getRecentTrades(100);
      expect(txRepo.findRecent).toHaveBeenCalledWith(50);
    });

    it('should use default limit 20', async () => {
      txRepo.findRecent.mockResolvedValue([]);
      await service.getRecentTrades();
      expect(txRepo.findRecent).toHaveBeenCalledWith(20);
    });
  });

  describe('getOhlcv', () => {
    it('should delegate to ClickHouse with params', async () => {
      const candles = [{ open: '1', high: '2', low: '0.5', close: '1.5', volume: '100' }];
      chService.getOHLCVData.mockResolvedValue(candles as any);

      const params = {
        artworkId: 'art-1',
        timeframe: '1h',
        from: new Date('2024-01-01'),
        to: new Date('2024-01-02'),
        limit: 100,
      };
      const result = await service.getOhlcv(params as any);
      expect(result).toEqual(candles);
    });
  });
});
