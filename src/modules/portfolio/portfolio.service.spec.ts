import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { Repository, DataSource } from 'typeorm';
import { PortfolioService } from './portfolio.service';
import { PortfolioHolding } from './entities/portfolio-holding.entity';
import { Artwork } from '../artworks/entities/artwork.entity';

describe('PortfolioService', () => {
  let service: PortfolioService;
  let holdingRepo: jest.Mocked<Repository<PortfolioHolding>>;
  let artworkRepo: jest.Mocked<Repository<Artwork>>;
  let dataSource: jest.Mocked<DataSource>;

  beforeEach(async () => {
    holdingRepo = { findOne: jest.fn() } as any;
    artworkRepo = {} as any;
    dataSource = { query: jest.fn() } as any;

    const module = await Test.createTestingModule({
      providers: [
        PortfolioService,
        { provide: getRepositoryToken(PortfolioHolding), useValue: holdingRepo },
        { provide: getRepositoryToken(Artwork), useValue: artworkRepo },
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();

    service = module.get(PortfolioService);
  });

  describe('calculatePortfolioPnL', () => {
    it('should throw NotFoundException for non-existent user', async () => {
      dataSource.query.mockResolvedValue([]);
      await expect(service.calculatePortfolioPnL('bad-id')).rejects.toThrow(NotFoundException);
    });

    it('should return empty portfolio when no holdings', async () => {
      dataSource.query
        .mockResolvedValueOnce([{ id: 'user-1' }])  // user exists
        .mockResolvedValueOnce([]);                   // no holdings

      const result = await service.calculatePortfolioPnL('user-1');
      expect(result.user_id).toBe('user-1');
      expect(result.total_current_value_eth).toBe('0.00000000');
      expect(result.holdings).toHaveLength(0);
    });

    it('should calculate P&L correctly with Decimal precision', async () => {
      dataSource.query
        .mockResolvedValueOnce([{ id: 'user-1' }])
        .mockResolvedValueOnce([
          {
            artwork_id: 'art-1',
            artwork_title: 'Genesis',
            artwork_status: 'ACTIVE',
            share_balance: '100.00000000',
            avg_buy_price: '0.00100000',
            current_price: '0.00200000',
          },
        ]);

      const result = await service.calculatePortfolioPnL('user-1');

      expect(result.holdings).toHaveLength(1);
      const h = result.holdings[0];
      expect(h.current_value_eth).toBe('0.20000000');   // 100 * 0.002
      expect(h.cost_basis_eth).toBe('0.10000000');       // 100 * 0.001
      expect(h.unrealized_pnl_eth).toBe('0.10000000');   // 0.2 - 0.1
      expect(h.unrealized_pnl_pct).toBe('100.00');       // +100%
    });

    it('should handle zero avg_buy_price (free mint)', async () => {
      dataSource.query
        .mockResolvedValueOnce([{ id: 'user-1' }])
        .mockResolvedValueOnce([
          {
            artwork_id: 'art-1',
            artwork_title: 'Free',
            artwork_status: 'ACTIVE',
            share_balance: '50.00000000',
            avg_buy_price: '0.00000000',
            current_price: '0.01000000',
          },
        ]);

      const result = await service.calculatePortfolioPnL('user-1');
      expect(result.holdings[0].unrealized_pnl_pct).toBe('0.00');
    });

    it('should aggregate multiple holdings correctly', async () => {
      dataSource.query
        .mockResolvedValueOnce([{ id: 'user-1' }])
        .mockResolvedValueOnce([
          {
            artwork_id: 'art-1', artwork_title: 'A', artwork_status: 'ACTIVE',
            share_balance: '10.00000000', avg_buy_price: '1.00000000', current_price: '2.00000000',
          },
          {
            artwork_id: 'art-2', artwork_title: 'B', artwork_status: 'ACTIVE',
            share_balance: '5.00000000', avg_buy_price: '2.00000000', current_price: '1.00000000',
          },
        ]);

      const result = await service.calculatePortfolioPnL('user-1');
      expect(result.total_current_value_eth).toBe('25.00000000'); // 10*2 + 5*1
      expect(result.total_cost_basis_eth).toBe('20.00000000');     // 10*1 + 5*2
      expect(result.total_unrealized_pnl_eth).toBe('5.00000000');
    });
  });

  describe('getUserHolding', () => {
    it('should return holding when found', async () => {
      const holding = { user_id: 'u1', artwork_id: 'a1', share_balance: '100' };
      holdingRepo.findOne.mockResolvedValue(holding as any);

      const result = await service.getUserHolding('u1', 'a1');
      expect(result).toEqual(holding);
    });

    it('should return null when no holding', async () => {
      holdingRepo.findOne.mockResolvedValue(null);
      const result = await service.getUserHolding('u1', 'a1');
      expect(result).toBeNull();
    });
  });

  describe('getTopHolders', () => {
    it('should return ranked holders from SQL query', async () => {
      const holders = [
        { rank: 1, wallet_address: '0x1', username: 'whale', share_balance: '500', ownership_pct: '50.00' },
        { rank: 2, wallet_address: '0x2', username: 'fish', share_balance: '300', ownership_pct: '30.00' },
      ];
      dataSource.query.mockResolvedValue(holders);

      const result = await service.getTopHolders('art-1', 10);
      expect(result).toHaveLength(2);
      expect(result[0].rank).toBe(1);
      expect(dataSource.query).toHaveBeenCalledWith(
        expect.stringContaining('RANK()'),
        ['art-1', 10],
      );
    });
  });
});
