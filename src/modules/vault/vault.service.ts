import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import Decimal from 'decimal.js';
import { CursorPage, buildCursorPage, decodeCursor } from '../../common/pagination/cursor.util';
import { InfraClickHouseService } from '../../shared/clickhouse/clickhouse-infra.service';

// Decimal.js config — match portfolio module precision
Decimal.set({ precision: 28, rounding: Decimal.ROUND_DOWN });

// ─── Types ────────────────────────────────────────────────────────────────────

export interface VaultOverview {
  total_value_eth: string;
  total_cost_basis_eth: string;
  unrealized_pnl_eth: string;
  unrealized_pnl_pct: string;
  realized_pnl_eth: string;
  eth_balance: string;
  holdings_count: number;
}

export interface VaultHolding {
  artwork_id: string;
  title: string;
  ticker: string;
  category: string;
  image_uri: string | null;
  share_balance: string;
  avg_buy_price: string;
  current_price: string;
  value_eth: string;
  cost_basis_eth: string;
  pnl_eth: string;
  pnl_pct: string;
}

export interface VaultTransaction {
  id: string;
  tx_hash: string;
  tx_type: string;
  artwork_id: string;
  artwork_title: string;
  artwork_ticker: string;
  artwork_image_uri: string | null;
  share_amount: string;
  eth_amount: string;
  price_per_share: string;
  gas_fee: string | null;
  timestamp: Date;
}

export interface PerformancePoint {
  date: string;
  value_eth: string;
}

// ─── Service ─────────────────────────────────────────────────────────────────

@Injectable()
export class VaultService {
  private readonly logger = new Logger(VaultService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly ch: InfraClickHouseService,
  ) {}

  // ─── getOverview ──────────────────────────────────────────────────────────

  async getOverview(userId: string): Promise<VaultOverview> {
    await this.ensureUserExists(userId);

    // 1. Holdings: unrealized P&L
    const holdings = await this.getHoldings(userId);

    const ZERO = new Decimal(0);

    const totalValue = holdings.reduce(
      (acc, h) => acc.plus(new Decimal(h.value_eth)), ZERO,
    );
    const totalCost = holdings.reduce(
      (acc, h) => acc.plus(new Decimal(h.cost_basis_eth)), ZERO,
    );
    const unrealizedPnl = totalValue.sub(totalCost);
    const unrealizedPct = totalCost.isZero()
      ? ZERO
      : unrealizedPnl.div(totalCost).mul(100);

    // 2. Realized P&L — tính bằng replay chronological với average-cost basis.
    //    KHÔNG dùng avg_buy_price hiện tại (sai vì nó thay đổi theo thời gian và =0
    //    sau khi thoát hết vị thế). Average-cost nhất quán với cách consumer duy trì
    //    avg_buy_price (weighted average trên mỗi BUY).
    const realizedPnl = await this.computeRealizedPnl(userId);

    // 3. ETH balance placeholder — would come from on-chain or wallet service
    const ethBalance = '0.00000000';

    return {
      total_value_eth: totalValue.toFixed(8),
      total_cost_basis_eth: totalCost.toFixed(8),
      unrealized_pnl_eth: unrealizedPnl.toFixed(8),
      unrealized_pnl_pct: unrealizedPct.toFixed(2),
      realized_pnl_eth: realizedPnl.toFixed(8),
      eth_balance: ethBalance,
      holdings_count: holdings.length,
    };
  }

  // ─── computeRealizedPnl ─────────────────────────────────────────────────────

  /**
   * Realized P&L theo average-cost basis (đúng về kế toán, nhất quán với avg_buy_price).
   *
   * Replay toàn bộ giao dịch theo thứ tự thời gian, giữ per-artwork { shares, cost }:
   *   - BUY  : shares += amount;  cost += eth
   *   - SELL : avgCost = cost / shares
   *            realized += sellEth − avgCost * sharesBán
   *            shares −= sharesBán;  cost −= avgCost * sharesBán
   *
   * Bounded theo số giao dịch của 1 user nên chạy in-memory là đủ nhanh.
   */
  private async computeRealizedPnl(userId: string): Promise<Decimal> {
    const txs: Array<{
      artwork_id: string;
      tx_type: string;
      share_amount: string;
      eth_amount: string;
    }> = await this.dataSource.query(
      `SELECT artwork_id, tx_type, share_amount, eth_amount
       FROM transactions
       WHERE user_id = $1 AND tx_type IN ('BUY', 'SELL')
       ORDER BY timestamp ASC, id ASC`,
      [userId],
    );

    const lots = new Map<string, { shares: Decimal; cost: Decimal }>();
    let realized = new Decimal(0);

    for (const tx of txs) {
      const shares = new Decimal(tx.share_amount || '0');
      const eth    = new Decimal(tx.eth_amount || '0');
      const lot = lots.get(tx.artwork_id) ?? { shares: new Decimal(0), cost: new Decimal(0) };

      if (tx.tx_type === 'BUY') {
        lot.shares = lot.shares.plus(shares);
        lot.cost   = lot.cost.plus(eth);
      } else {
        // SELL — average cost của số cổ phần đang giữ
        const sold = Decimal.min(shares, lot.shares);
        const avgCost = lot.shares.isZero() ? new Decimal(0) : lot.cost.div(lot.shares);
        const costRemoved = avgCost.mul(sold);
        realized = realized.plus(eth.sub(costRemoved));
        lot.shares = lot.shares.sub(sold);
        lot.cost   = Decimal.max(new Decimal(0), lot.cost.sub(costRemoved));
      }
      lots.set(tx.artwork_id, lot);
    }

    return realized;
  }

  // ─── getHoldings ──────────────────────────────────────────────────────────

  async getHoldings(userId: string): Promise<VaultHolding[]> {
    const rows: Array<{
      artwork_id: string;
      title: string;
      ticker: string;
      category: string;
      image_uri: string | null;
      share_balance: string;
      avg_buy_price: string;
      current_price: string;
    }> = await this.dataSource.query(
      `SELECT
         ph.artwork_id,
         a.title,
         COALESCE(a.ticker, '') AS ticker,
         COALESCE(a.category, '') AS category,
         a.image_uri,
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

    return rows.map((row) => {
      const shares   = new Decimal(row.share_balance);
      const avgPrice = new Decimal(row.avg_buy_price);
      const curPrice = new Decimal(row.current_price);

      const valueEth  = shares.mul(curPrice);
      const costBasis = shares.mul(avgPrice);
      const pnlEth    = valueEth.sub(costBasis);
      const pnlPct    = avgPrice.isZero()
        ? new Decimal(0)
        : curPrice.sub(avgPrice).div(avgPrice).mul(100);

      return {
        artwork_id:    row.artwork_id,
        title:         row.title,
        ticker:        row.ticker,
        category:      row.category,
        image_uri:     row.image_uri,
        share_balance: shares.toFixed(8),
        avg_buy_price: avgPrice.toFixed(8),
        current_price: curPrice.toFixed(8),
        value_eth:     valueEth.toFixed(8),
        cost_basis_eth: costBasis.toFixed(8),
        pnl_eth:       pnlEth.toFixed(8),
        pnl_pct:       pnlPct.toFixed(2),
      };
    });
  }

  // ─── getTransactionHistoryCursor (keyset — production scale) ─────────────────

  /**
   * Lịch sử giao dịch theo keyset pagination — O(limit) ở mọi độ sâu.
   * Dùng index (user_id, timestamp DESC). Tiebreaker theo id để ổn định khi
   * nhiều giao dịch cùng timestamp (tránh nhảy/trùng dòng giữa các trang).
   */
  async getTransactionHistoryCursor(
    userId: string,
    limit = 20,
    side?: 'buy' | 'sell',
    cursor?: string,
  ): Promise<CursorPage<VaultTransaction>> {
    const decoded = decodeCursor(cursor);
    const params: any[] = [userId];
    const conds: string[] = ['t.user_id = $1'];

    if (side) {
      params.push(side.toUpperCase());
      conds.push(`t.tx_type = $${params.length}`);
    }
    if (decoded) {
      // keyset: chỉ lấy bản ghi "cũ hơn" cursor theo (timestamp, id) DESC
      params.push(decoded.ts);
      const tsIdx = params.length;
      params.push(decoded.id);
      const idIdx = params.length;
      conds.push(`(t.timestamp, t.id) < ($${tsIdx}::timestamptz, $${idIdx}::uuid)`);
    }
    params.push(limit + 1); // +1 để biết còn trang sau không
    const limitIdx = params.length;

    const rows: any[] = await this.dataSource.query(
      `SELECT t.id, t.tx_hash, t.tx_type,
              t.share_amount::TEXT, t.eth_amount::TEXT,
              t.price_per_share::TEXT, t.gas_fee::TEXT,
              t.timestamp,
              a.id AS artwork_id, a.title AS artwork_title,
              COALESCE(a.ticker, '') AS artwork_ticker,
              a.image_uri AS artwork_image_uri
       FROM   transactions t
       INNER  JOIN artworks a ON t.artwork_id = a.id
       WHERE  ${conds.join(' AND ')}
       ORDER  BY t.timestamp DESC, t.id DESC
       LIMIT  $${limitIdx}`,
      params,
    );

    const mapped: Array<VaultTransaction & { _id: string; _ts: Date }> = rows.map((r) => ({
      id:                r.id,
      tx_hash:           r.tx_hash,
      tx_type:           r.tx_type,
      artwork_id:        r.artwork_id,
      artwork_title:     r.artwork_title,
      artwork_ticker:    r.artwork_ticker,
      artwork_image_uri: r.artwork_image_uri,
      share_amount:      r.share_amount,
      eth_amount:        r.eth_amount,
      price_per_share:   r.price_per_share,
      gas_fee:           r.gas_fee,
      timestamp:         r.timestamp,
      _id:               r.id,
      _ts:               r.timestamp,
    }));

    const page = buildCursorPage(mapped, limit, (row) => ({ ts: row._ts, id: row._id }));
    // strip internal keys khỏi payload trả về
    return {
      ...page,
      data: page.data.map(({ _id, _ts, ...rest }) => rest),
    };
  }

  // ─── getTransactionHistory (legacy OFFSET — giữ cho tương thích) ─────────────

  async getTransactionHistory(
    userId: string,
    page  = 1,
    limit = 20,
    side?: 'buy' | 'sell',
  ): Promise<{
    data: VaultTransaction[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    const offset = (page - 1) * limit;

    const sideFilter = side
      ? `AND t.tx_type = $4`
      : '';
    const params: any[] = [userId, limit, offset];
    if (side) params.push(side.toUpperCase());

    const [rows, countRes]: [any[], [{ count: string }]] = await Promise.all([
      this.dataSource.query(
        `SELECT t.id, t.tx_hash, t.tx_type,
                t.share_amount::TEXT, t.eth_amount::TEXT,
                t.price_per_share::TEXT, t.gas_fee::TEXT,
                t.timestamp,
                a.id AS artwork_id, a.title AS artwork_title,
                COALESCE(a.ticker, '') AS artwork_ticker,
                a.image_uri AS artwork_image_uri
         FROM   transactions t
         INNER  JOIN artworks a ON t.artwork_id = a.id
         WHERE  t.user_id = $1
                ${sideFilter}
         ORDER  BY t.timestamp DESC
         LIMIT  $2 OFFSET $3`,
        params,
      ),
      this.dataSource.query(
        `SELECT COUNT(*)::TEXT AS count
         FROM transactions t
         WHERE t.user_id = $1
               ${side ? `AND t.tx_type = $2` : ''}`,
        side ? [userId, side.toUpperCase()] : [userId],
      ),
    ]);

    const total = parseInt(countRes[0].count, 10);

    return {
      data: rows.map((r) => ({
        id:               r.id,
        tx_hash:          r.tx_hash,
        tx_type:          r.tx_type,
        artwork_id:       r.artwork_id,
        artwork_title:    r.artwork_title,
        artwork_ticker:   r.artwork_ticker,
        artwork_image_uri: r.artwork_image_uri,
        share_amount:     r.share_amount,
        eth_amount:       r.eth_amount,
        price_per_share:  r.price_per_share,
        gas_fee:          r.gas_fee,
        timestamp:        r.timestamp,
      })),
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }

  // ─── getPerformance ───────────────────────────────────────────────────────

  /**
   * Daily portfolio value snapshots — ĐỊNH GIÁ THEO GIÁ LỊCH SỬ (đúng).
   *
   * Với mỗi ngày D: value(D) = Σ_artwork ( shares_held(artwork, cuối ngày D)
   *                                        × close_price(artwork, ngày D) ).
   *   - shares_held: cộng dồn BUY(+)/SELL(−) tới hết ngày D từ transactions.
   *   - close_price: nến đóng cửa 1d từ ClickHouse, forward-fill cho ngày không có trade,
   *                  fallback current_price khi chưa có nến nào.
   *
   * Nếu ClickHouse hoàn toàn không có dữ liệu OHLCV (vd dev) → fallback sang
   * cash-flow approximation (computePerformanceApprox) để không vỡ chart.
   */
  async getPerformance(
    userId: string,
    period: '7d' | '30d' | '90d',
  ): Promise<PerformancePoint[]> {
    const days = period === '7d' ? 7 : period === '30d' ? 30 : 90;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    startDate.setHours(0, 0, 0, 0);
    const now = new Date();

    // Toàn bộ giao dịch BUY/SELL (cần full history để biết shares as-of mỗi ngày)
    const txs: Array<{ artwork_id: string; tx_type: string; share_amount: string; timestamp: string }> =
      await this.dataSource.query(
        `SELECT artwork_id, tx_type, share_amount::TEXT, timestamp
         FROM transactions
         WHERE user_id = $1 AND tx_type IN ('BUY','SELL')
         ORDER BY timestamp ASC`,
        [userId],
      );

    if (!txs.length) {
      return this.emptyPerformanceSeries(startDate);
    }

    const artworkIds = [...new Set(txs.map((t) => t.artwork_id))];

    // Nến đóng cửa hằng ngày — lấy cửa sổ rộng (1 năm trước startDate) để forward-fill
    const histStart = new Date(startDate);
    histStart.setFullYear(histStart.getFullYear() - 1);

    const closesByArt = new Map<string, Array<{ day: string; close: Decimal }>>();
    let totalCandles = 0;
    await Promise.all(
      artworkIds.map(async (id) => {
        try {
          const candles = await this.ch.getOHLCVData(id, '1d', histStart, now, 500);
          totalCandles += candles.length;
          closesByArt.set(
            id,
            candles.map((c) => ({ day: c.bucket.slice(0, 10), close: new Decimal(c.close || '0') })),
          );
        } catch {
          closesByArt.set(id, []);
        }
      }),
    );

    // Không có OHLCV nào → fallback approximation
    if (totalCandles === 0) {
      return this.computePerformanceApprox(userId, startDate);
    }

    // current_price làm giá fallback khi ngày D nằm trước nến đầu tiên
    const priceRows: Array<{ id: string; current_price: string }> = await this.dataSource.query(
      `SELECT id, current_price::TEXT AS current_price FROM artworks WHERE id = ANY($1)`,
      [artworkIds],
    );
    const fallbackPrice = new Map<string, Decimal>(
      priceRows.map((r) => [r.id, new Decimal(r.current_price || '0')]),
    );

    // Danh sách ngày tăng dần
    const dayList: string[] = [];
    for (let d = new Date(startDate); d <= now; d.setDate(d.getDate() + 1)) {
      dayList.push(d.toISOString().slice(0, 10));
    }

    // Con trỏ tiến dần (merge) để giữ O(days + txs + candles)
    const sharesByArt = new Map<string, Decimal>();
    const closePtr = new Map<string, number>();
    const lastClose = new Map<string, Decimal>();
    let txPtr = 0;

    const points: PerformancePoint[] = [];
    for (const day of dayList) {
      // Áp dụng mọi giao dịch tới hết ngày D
      while (txPtr < txs.length && txs[txPtr].timestamp.slice(0, 10) <= day) {
        const tx = txs[txPtr];
        const delta = new Decimal(tx.share_amount || '0');
        const prev = sharesByArt.get(tx.artwork_id) ?? new Decimal(0);
        sharesByArt.set(tx.artwork_id, tx.tx_type === 'BUY' ? prev.plus(delta) : prev.sub(delta));
        txPtr++;
      }

      let value = new Decimal(0);
      for (const id of artworkIds) {
        const sh = sharesByArt.get(id);
        if (!sh || sh.lte(0)) continue;

        // forward-fill giá đóng cửa <= day
        const closes = closesByArt.get(id) ?? [];
        let ptr = closePtr.get(id) ?? 0;
        while (ptr < closes.length && closes[ptr].day <= day) {
          lastClose.set(id, closes[ptr].close);
          ptr++;
        }
        closePtr.set(id, ptr);

        const price = lastClose.get(id) ?? fallbackPrice.get(id) ?? new Decimal(0);
        value = value.plus(sh.mul(price));
      }
      points.push({ date: day, value_eth: value.toFixed(8) });
    }

    return points;
  }

  /** Chuỗi giá trị 0 cho user chưa có giao dịch. */
  private emptyPerformanceSeries(startDate: Date): PerformancePoint[] {
    const now = new Date();
    const points: PerformancePoint[] = [];
    for (let d = new Date(startDate); d <= now; d.setDate(d.getDate() + 1)) {
      points.push({ date: d.toISOString().slice(0, 10), value_eth: '0.00000000' });
    }
    return points;
  }

  /**
   * FALLBACK — cash-flow approximation (dùng khi ClickHouse chưa có OHLCV).
   * value(day-1) ≈ value(day) − net_flow(day). Không phản ánh biến động giá của
   * cổ phần đang giữ, nên chỉ dùng khi không có dữ liệu giá lịch sử.
   */
  private async computePerformanceApprox(
    userId: string,
    startDate: Date,
  ): Promise<PerformancePoint[]> {
    // Get daily net ETH flow from transactions (buy = negative, sell = positive)
    const dailyFlows: Array<{ day: string; net_eth: string }> =
      await this.dataSource.query(
        `SELECT
           DATE(t.timestamp) AS day,
           SUM(
             CASE WHEN t.tx_type = 'SELL' THEN t.eth_amount
                  WHEN t.tx_type = 'BUY'  THEN -t.eth_amount
                  ELSE 0
             END
           )::TEXT AS net_eth
         FROM transactions t
         WHERE t.user_id = $1
           AND t.timestamp >= $2
         GROUP BY DATE(t.timestamp)
         ORDER BY day ASC`,
        [userId, startDate],
      );

    // Get current total portfolio value
    const holdingsRows: Array<{ total_value: string }> =
      await this.dataSource.query(
        `SELECT COALESCE(SUM(ph.share_balance * a.current_price), 0)::TEXT AS total_value
         FROM portfolio_holdings ph
         INNER JOIN artworks a ON ph.artwork_id = a.id
         WHERE ph.user_id = $1 AND ph.share_balance > 0`,
        [userId],
      );

    const currentValue = new Decimal(holdingsRows[0]?.total_value ?? '0');

    // Build daily flow map
    const flowMap = new Map<string, Decimal>();
    for (const f of dailyFlows) {
      flowMap.set(f.day, new Decimal(f.net_eth));
    }

    // Walk backwards from today to reconstruct daily values
    // value(day-1) = value(day) - net_flow(day)  (approximate)
    const points: PerformancePoint[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let runningValue = currentValue;

    // Build array from today backwards, then reverse
    for (let d = new Date(today); d >= startDate; d.setDate(d.getDate() - 1)) {
      const dateStr = d.toISOString().slice(0, 10);
      points.push({ date: dateStr, value_eth: runningValue.toFixed(8) });

      // Walk back: subtract net flow of this day
      const flow = flowMap.get(dateStr);
      if (flow) {
        runningValue = runningValue.sub(flow);
      }
    }

    points.reverse();
    return points;
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private async ensureUserExists(userId: string): Promise<void> {
    const result = await this.dataSource.query(
      `SELECT id FROM users WHERE id = $1`,
      [userId],
    );
    if (!result.length) {
      throw new NotFoundException(`User ${userId} not found`);
    }
  }
}
