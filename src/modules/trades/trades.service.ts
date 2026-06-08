import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InfraClickHouseService, OhlcvTimeframe, OhlcvCandle } from '../../shared/clickhouse/clickhouse-infra.service';
import { TransactionRepository } from './repositories/transaction.repository';
import { DataSource } from 'typeorm';

// ─────────────────────────────────────────────────────────────────────────────
//  TradesService  (src/modules/trades/)
//
//  Business service cho lịch sử giao dịch và dữ liệu chart.
//  CHỈ ĐỌC — không write trực tiếp (write đi qua RabbitMQ Consumer).
//
//  Inject InfraClickHouseService từ infrastructure layer.
//  KHÔNG inject raw ClickHouseClient.
// ─────────────────────────────────────────────────────────────────────────────

export interface TradeHistoryItem {
  tx_hash:         string;
  tx_type:         'buy' | 'sell';
  user_id:         string;
  share_amount:    string;
  eth_amount:      string;
  price_per_share: string;
  gas_fee:         string;
  block_number:    number;
  timestamp:       Date;
}

export interface OhlcvQueryParams {
  artworkId: string;
  timeframe: OhlcvTimeframe;
  from:      Date;
  to:        Date;
  limit?:    number;
}

export interface VolumeStatsResult {
  artwork_id:  string;
  volume_eth:  string;
  trade_count: string;
}

@Injectable()
export class TradesService {
  private readonly logger = new Logger(TradesService.name);

  constructor(
    private readonly chService: InfraClickHouseService,
    private readonly txRepo: TransactionRepository,
    private readonly dataSource: DataSource,
  ) {}

  // ── OHLCV (Candlestick Chart) ──────────────────────────────────────────────

  /**
   * Lấy dữ liệu OHLCV cho Frontend vẽ candlestick chart.
   *
   * Delegates to InfraClickHouseService.getOHLCVData() — query từ
   * Materialized View đã pre-compute (không aggregate raw trades).
   *
   * @param params  { artworkId, timeframe, from, to, limit }
   * @returns       Mảng OhlcvCandle sorted ASC theo bucket
   */
  async getOhlcv(params: OhlcvQueryParams): Promise<OhlcvCandle[]> {
    const { artworkId, timeframe, from, to, limit = 500 } = params;

    this.logger.debug(
      `[OHLCV] artworkId=${artworkId} timeframe=${timeframe} ` +
      `from=${from.toISOString()} to=${to.toISOString()}`,
    );

    return this.chService.getOHLCVData(artworkId, timeframe, from, to, limit);
  }

  // ── Trade History ──────────────────────────────────────────────────────────

  /**
   * Lịch sử giao dịch raw của 1 artwork (cho trang detail).
   * Dùng cursor-based pagination (by timestamp) thay vì OFFSET để performance.
   *
   * TODO: Implement cursor pagination khi traffic cao.
   * Hiện tại dùng OFFSET — an toàn cho < 1M rows.
   */
  async getTradeHistory(
    artworkId: string,
    limit  = 50,
    offset = 0,
  ): Promise<TradeHistoryItem[]> {
    this.logger.debug(`[TradeHistory] artworkId=${artworkId} limit=${limit} offset=${offset}`);
    const rows = await this.chService.getTradeHistory(artworkId, limit, offset);
    return rows.map(r => ({
      tx_hash:         r.tx_hash,
      tx_type:         r.tx_type,
      user_id:         r.user_id,
      share_amount:    r.share_amount,
      eth_amount:      r.eth_amount,
      price_per_share: r.price_per_share,
      gas_fee:         r.gas_fee,
      block_number:    r.block_number,
      timestamp:       r.timestamp,
    }));
  }

  // ── Trade History Paginated (FIX 2) ───────────────────────────────────────

  /**
   * Lịch sử giao dịch của 1 artwork — trả về response có pagination wrapper.
   * Consistent với format của ArtworksService.getArtworkTradingHistory.
   */
  async getTradeHistoryPaginated(
    artworkId: string,
    page  = 1,
    limit = 50,
  ): Promise<{ data: TradeHistoryItem[]; total: number; page: number; limit: number }> {
    this.logger.debug(`[TradeHistoryPaginated] artworkId=${artworkId} page=${page} limit=${limit}`);
    const offset = (page - 1) * limit;
    const rows   = await this.chService.getTradeHistory(artworkId, limit, offset);

    // ClickHouse không hỗ trợ COUNT(*) song song trong cùng query — dùng query riêng
    const countResult = await this.chService.countTradeHistory(artworkId);

    const data: TradeHistoryItem[] = rows.map(r => ({
      tx_hash:         r.tx_hash,
      tx_type:         r.tx_type,
      user_id:         r.user_id,
      share_amount:    r.share_amount,
      eth_amount:      r.eth_amount,
      price_per_share: r.price_per_share,
      gas_fee:         r.gas_fee,
      block_number:    r.block_number,
      timestamp:       r.timestamp,
    }));

    return { data, total: countResult, page, limit };
  }

  // ── User Transaction History (FIX 3) ──────────────────────────────────────

  /**
   * Lịch sử giao dịch của user đang đăng nhập — query PostgreSQL transactions.
   * Trả về pagination wrapper { data, total, page, totalPages }.
   */
  async getUserTransactionHistory(
    userId: string,
    page  = 1,
    limit = 20,
  ): Promise<{
    data:       any[];
    total:      number;
    page:       number;
    totalPages: number;
  }> {
    this.logger.debug(`[UserTxHistory] userId=${userId} page=${page} limit=${limit}`);
    const offset = (page - 1) * limit;

    const [rows, countRes]: [any[], [{ count: string }]] = await Promise.all([
      this.dataSource.query(
        `SELECT t.id, t.tx_hash, t.tx_type,
                t.share_amount, t.eth_amount, t.price_per_share, t.gas_fee,
                t.block_number, t.timestamp, t.created_at,
                a.id AS artwork_id, a.title AS artwork_title,
                a.ticker AS artwork_ticker, a.image_uri AS artwork_image_uri
         FROM   transactions t
         INNER  JOIN artworks a ON t.artwork_id = a.id
         WHERE  t.user_id = $1
         ORDER  BY t.timestamp DESC
         LIMIT  $2 OFFSET $3`,
        [userId, limit, offset],
      ),
      this.dataSource.query(
        `SELECT COUNT(*) FROM transactions WHERE user_id = $1`,
        [userId],
      ),
    ]);

    const total = parseInt(countRes[0].count, 10);
    return {
      data:       rows,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }

  // ── Volume Stats ───────────────────────────────────────────────────────────

  /**
   * Volume 24h của 1 artwork.
   * Dùng làm fallback khi Redis cache miss (RedisService.getArtworkPrice không có data).
   */
  async getVolume24h(artworkId: string): Promise<string> {
    return this.chService.getVolume24h(artworkId);
  }

  /**
   * Top N artworks theo volume 7 ngày — cho leaderboard trang chủ.
   */
  async getTopByVolume(limit = 20): Promise<VolumeStatsResult[]> {
    return this.chService.getTopByVolume(limit);
  }

  // ── Recent Trades (cross-artwork) ─────────────────────────────────────────

  async getRecentTrades(limit = 20) {
    return this.txRepo.findRecent(Math.min(limit, 50));
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  /**
   * Parse "from" và "to" query params với fallback thông minh.
   * Nếu không có from/to: mặc định lấy 24h gần nhất.
   */
  parseTimeRange(
    fromStr?: string,
    toStr?:   string,
    defaultHours = 24,
  ): { from: Date; to: Date } {
    const to   = toStr   ? new Date(toStr)   : new Date();
    const from = fromStr ? new Date(fromStr) : new Date(to.getTime() - defaultHours * 3600 * 1000);
    return { from, to };
  }
}
