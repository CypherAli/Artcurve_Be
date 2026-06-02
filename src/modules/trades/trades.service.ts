import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InfraClickHouseService, OhlcvTimeframe, OhlcvCandle } from '../../shared/clickhouse/clickhouse-infra.service';

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
    // TODO: delegate to chService.getTradeHistory() sau khi thêm method
    this.logger.debug(`[TradeHistory] artworkId=${artworkId} limit=${limit} offset=${offset}`);
    return [];  // Placeholder — implement khi cần
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
