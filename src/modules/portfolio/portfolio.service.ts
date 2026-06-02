import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import Decimal from 'decimal.js';
import { PortfolioHolding } from './entities/portfolio-holding.entity';
import { Artwork } from '../artworks/entities/artwork.entity';

// Decimal.js config — đủ precision cho DeFi (18 significant digits, no rounding on DECIMAL(18,8))
Decimal.set({ precision: 28, rounding: Decimal.ROUND_DOWN });

// ─── Types ────────────────────────────────────────────────────────────────────

export interface HoldingWithPnL {
  artwork_id: string;
  artwork_title: string;
  artwork_status: string;
  share_balance: string;
  avg_buy_price: string;
  current_price: string;
  current_value_eth: string;
  cost_basis_eth: string;
  unrealized_pnl_eth: string;
  unrealized_pnl_pct: string;
}

export interface PortfolioPnL {
  user_id: string;
  total_current_value_eth: string;
  total_cost_basis_eth: string;
  total_unrealized_pnl_eth: string;
  total_unrealized_pnl_pct: string;
  holdings: HoldingWithPnL[];
}

// ─── Service ─────────────────────────────────────────────────────────────────

@Injectable()
export class PortfolioService {
  private readonly logger = new Logger(PortfolioService.name);

  constructor(
    @InjectRepository(PortfolioHolding)
    private readonly holdingRepo: Repository<PortfolioHolding>,

    @InjectRepository(Artwork)
    private readonly artworkRepo: Repository<Artwork>,

    private readonly dataSource: DataSource,
  ) {}

  // ─── calculatePortfolioPnL ─────────────────────────────────────────────────

  /**
   * Tính P&L cho toàn bộ portfolio của một user.
   *
   * BẮT BUỘC dùng Decimal.js cho mọi phép tính tiền tệ.
   * Lý do: JS Number (IEEE 754 float64) gây sai số với DECIMAL(18,8).
   * Ví dụ: 0.1 + 0.2 = 0.30000000000000004 trong JS — KHÔNG CHẤP NHẬN ĐƯỢC với DeFi.
   *
   * PostgreSQL tính raw values chính xác, Node.js chỉ nhận về string rồi
   * dùng Decimal.js để aggregate — tránh hoàn toàn JS float contamination.
   */
  async calculatePortfolioPnL(userId: string): Promise<PortfolioPnL> {
    const userExists = await this.dataSource.query(
      `SELECT id FROM users WHERE id = $1`,
      [userId],
    );
    if (!userExists.length) throw new NotFoundException(`User ${userId} không tồn tại`);

    // PostgreSQL trả về string cho các cột DECIMAL — KHÔNG ép về float ở đây
    const rows: Array<{
      artwork_id: string;
      artwork_title: string;
      artwork_status: string;
      share_balance: string;    // string từ PG DECIMAL
      avg_buy_price: string;    // string từ PG DECIMAL
      current_price: string;    // string từ PG DECIMAL
    }> = await this.dataSource.query(
      `SELECT
         ph.artwork_id,
         a.title       AS artwork_title,
         a.status      AS artwork_status,
         ph.share_balance::TEXT,
         ph.avg_buy_price::TEXT,
         a.current_price::TEXT
       FROM portfolio_holdings ph
       INNER JOIN artworks a ON ph.artwork_id = a.id
       WHERE ph.user_id = $1
         AND ph.share_balance > 0
       ORDER BY ph.share_balance * a.current_price DESC`,
      [userId],
    );

    if (!rows.length) {
      return {
        user_id: userId,
        total_current_value_eth: '0.00000000',
        total_cost_basis_eth: '0.00000000',
        total_unrealized_pnl_eth: '0.00000000',
        total_unrealized_pnl_pct: '0.00',
        holdings: [],
      };
    }

    // ── Tính từng holding bằng Decimal.js — TUYỆT ĐỐI không dùng +, -, *, / ──
    const holdings: HoldingWithPnL[] = rows.map((row) => {
      const shares   = new Decimal(row.share_balance);
      const avgPrice = new Decimal(row.avg_buy_price);
      const curPrice = new Decimal(row.current_price);

      const currentValue  = shares.mul(curPrice);                 // shares × current_price
      const costBasis     = shares.mul(avgPrice);                 // shares × avg_buy_price
      const pnlEth        = currentValue.sub(costBasis);          // current - cost

      // % PnL — guard tránh chia 0 (avgPrice = 0 khi mint free)
      const pnlPct = avgPrice.isZero()
        ? new Decimal(0)
        : curPrice.sub(avgPrice).div(avgPrice).mul(100);

      return {
        artwork_id:          row.artwork_id,
        artwork_title:       row.artwork_title,
        artwork_status:      row.artwork_status,
        share_balance:       shares.toFixed(8),
        avg_buy_price:       avgPrice.toFixed(8),
        current_price:       curPrice.toFixed(8),
        current_value_eth:   currentValue.toFixed(8),
        cost_basis_eth:      costBasis.toFixed(8),
        unrealized_pnl_eth:  pnlEth.toFixed(8),
        unrealized_pnl_pct:  pnlPct.toFixed(2),
      };
    });

    // ── Tính tổng portfolio — dùng reduce với Decimal accumulator ──────────────
    const ZERO = new Decimal(0);

    const totalCurrentValue = holdings.reduce(
      (acc, h) => acc.plus(new Decimal(h.current_value_eth)),
      ZERO,
    );

    const totalCostBasis = holdings.reduce(
      (acc, h) => acc.plus(new Decimal(h.cost_basis_eth)),
      ZERO,
    );

    const totalPnLEth = totalCurrentValue.sub(totalCostBasis);

    const totalPnLPct = totalCostBasis.isZero()
      ? new Decimal(0)
      : totalPnLEth.div(totalCostBasis).mul(100);

    return {
      user_id:                    userId,
      total_current_value_eth:    totalCurrentValue.toFixed(8),
      total_cost_basis_eth:       totalCostBasis.toFixed(8),
      total_unrealized_pnl_eth:   totalPnLEth.toFixed(8),
      total_unrealized_pnl_pct:   totalPnLPct.toFixed(2),
      holdings,
    };
  }

  // ─── getUserHolding ────────────────────────────────────────────────────────

  async getUserHolding(userId: string, artworkId: string): Promise<PortfolioHolding | null> {
    return this.holdingRepo.findOne({
      where: { user_id: userId, artwork_id: artworkId },
    });
  }

  // ─── getTopHolders ─────────────────────────────────────────────────────────

  async getTopHolders(
    artworkId: string,
    limit = 10,
  ): Promise<Array<{
    rank: number;
    wallet_address: string;
    username: string;
    share_balance: string;
    ownership_pct: string;
  }>> {
    // PostgreSQL tính ownership_pct với NUMERIC — không cần Decimal.js ở đây
    return this.dataSource.query(
      `WITH total AS (
         SELECT SUM(share_balance) AS total_supply
         FROM portfolio_holdings
         WHERE artwork_id = $1 AND share_balance > 0
       )
       SELECT
         RANK() OVER (ORDER BY ph.share_balance DESC)::INTEGER         AS rank,
         u.wallet_address,
         COALESCE(u.username, SUBSTRING(u.wallet_address, 1, 10) || '...') AS username,
         ph.share_balance::TEXT,
         ROUND(
           (ph.share_balance / NULLIF(total.total_supply, 0)) * 100, 2
         )::TEXT  AS ownership_pct
       FROM portfolio_holdings ph
       INNER JOIN users u ON ph.user_id = u.id
       CROSS JOIN total
       WHERE ph.artwork_id = $1 AND ph.share_balance > 0
       ORDER BY ph.share_balance DESC
       LIMIT $2`,
      [artworkId, limit],
    );
  }
}
