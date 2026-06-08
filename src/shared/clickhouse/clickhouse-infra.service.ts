import { Injectable, Inject, Logger } from '@nestjs/common';
import type { ClickHouseClient } from '@clickhouse/client';
import { INFRA_CLICKHOUSE_CLIENT } from './clickhouse.tokens';

// ─────────────────────────────────────────────────────────────────────────────
//  InfraClickHouseService  (src/infrastructure/clickhouse/)
//
//  Infrastructure service — cầu nối giữa business modules và ClickHouse client.
//  Cung cấp các helper method chuẩn hóa, đặc biệt là OHLCV query
//  cho Frontend vẽ candlestick chart.
//
//  RULE:
//    - Module nghiệp vụ (trades, artworks...) inject InfraClickHouseService
//    - KHÔNG inject raw ClickHouseClient trực tiếp vào business code
//    - Mọi query đều dùng parameterized format (chống SQL injection)
// ─────────────────────────────────────────────────────────────────────────────

// ── Types ─────────────────────────────────────────────────────────────────────

/** Timeframe chuẩn cho candlestick chart */
export type OhlcvTimeframe = '1m' | '5m' | '15m' | '1h' | '4h' | '1d';

/** Một cây nến OHLCV trả về cho Frontend */
export interface OhlcvCandle {
  bucket:      string;  // ISO-8601, e.g. "2024-01-01T00:00:00.000Z"
  open:        string;  // giá mở cửa — chuỗi wei để tránh float precision
  high:        string;  // giá cao nhất trong interval
  low:         string;  // giá thấp nhất trong interval
  close:       string;  // giá đóng cửa
  volume:      string;  // tổng ETH (wei) trong interval
  trade_count: string;  // số lượng giao dịch
}

/** Row insert vào bảng trades */
export interface TradeRow {
  artwork_id:      string;
  tx_hash:         string;
  user_id:         string;
  tx_type:         'buy' | 'sell';
  share_amount:    string;
  eth_amount:      string;
  price_per_share: string;
  gas_fee:         string;
  block_number:    number;
  timestamp:       Date;
}

// ── Mapping timeframe → tên Materialized View ─────────────────────────────────
// Mỗi MV đã pre-compute OHLCV theo interval tương ứng.
// Query trực tiếp MV thay vì aggregate từ bảng trades raw.
const OHLCV_TABLE: Record<OhlcvTimeframe, string> = {
  '1m':  'ohlcv_1m',
  '5m':  'ohlcv_5m',
  '15m': 'ohlcv_15m',
  '1h':  'ohlcv_1h',
  '4h':  'ohlcv_4h',
  '1d':  'ohlcv_1d',
};

@Injectable()
export class InfraClickHouseService {
  private readonly logger = new Logger(InfraClickHouseService.name);

  constructor(
    @Inject(INFRA_CLICKHOUSE_CLIENT)
    private readonly ch: ClickHouseClient,
  ) {}

  // ══════════════════════════════════════════════════════════════════════════
  //  OHLCV  —  Dữ liệu nến chuẩn bị cho Frontend vẽ chart
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Lấy OHLCV candles từ Materialized View đã pre-compute.
   *
   * KHÔNG query trực tiếp bảng trades — chỉ đọc từ MV ohlcv_{timeframe}.
   * Materialized View tự động cập nhật khi có trade mới qua Consumer.
   *
   * Sử dụng AggregatingMergeTree với -Merge state functions:
   *   argMinMerge(open)  → giá đầu tiên trong bucket
   *   maxMerge(high)     → giá cao nhất
   *   minMerge(low)      → giá thấp nhất
   *   argMaxMerge(close) → giá cuối cùng trong bucket
   *   sumMerge(volume)   → tổng ETH traded
   *   countMerge(trade_count) → số lượng trades
   *
   * Frontend dùng kết quả này để vẽ:
   *   - Candlestick chart (TradingView Lightweight Charts)
   *   - Volume bars phía dưới chart
   *
   * @param artworkId  UUID của artwork trong PostgreSQL
   * @param timeframe  Khung thời gian: '1m' | '5m' | '15m' | '1h' | '4h' | '1d'
   * @param from       Thời điểm bắt đầu (inclusive)
   * @param to         Thời điểm kết thúc (inclusive)
   * @param limit      Số nến tối đa (default 500 — đủ cho chart 8 tiếng @1m)
   */
  async getOHLCVData(
    artworkId: string,
    timeframe: OhlcvTimeframe,
    from: Date,
    to: Date,
    limit = 500,
  ): Promise<OhlcvCandle[]> {
    const table = OHLCV_TABLE[timeframe];

    // TODO: Tạo Materialized View trong ClickHouse migration:
    // CREATE MATERIALIZED VIEW ohlcv_1m
    // ENGINE = AggregatingMergeTree()
    // PARTITION BY toYYYYMM(bucket)
    // ORDER BY (artwork_id, bucket)
    // AS SELECT
    //   artwork_id,
    //   toStartOfMinute(timestamp) AS bucket,
    //   argMinState(price_per_share, timestamp) AS open,
    //   maxState(price_per_share)               AS high,
    //   minState(price_per_share)               AS low,
    //   argMaxState(price_per_share, timestamp) AS close,
    //   sumState(eth_amount)                    AS volume,
    //   countState()                            AS trade_count
    // FROM trades GROUP BY artwork_id, bucket;

    const result = await this.ch.query({
      query: `
        SELECT
          bucket,
          toString(argMinMerge(open))        AS open,
          toString(maxMerge(high))            AS high,
          toString(minMerge(low))             AS low,
          toString(argMaxMerge(close))        AS close,
          toString(sumMerge(volume))          AS volume,
          toString(countMerge(trade_count))   AS trade_count
        FROM ${table}
        WHERE artwork_id = {artwork_id: UUID}
          AND bucket BETWEEN {from: DateTime} AND {to: DateTime}
        GROUP BY artwork_id, bucket
        ORDER BY bucket ASC
        LIMIT {limit: UInt32}
      `,
      query_params: {
        artwork_id: artworkId,
        from:       from.toISOString().replace('T', ' ').substring(0, 19),
        to:         to.toISOString().replace('T', ' ').substring(0, 19),
        limit,
      },
      format: 'JSONEachRow',
    });

    const rows = await result.json<OhlcvCandle>();
    this.logger.debug(`[OHLCV] artworkId=${artworkId} tf=${timeframe} rows=${rows.length}`);
    return rows;
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  TRADE HISTORY
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Lịch sử giao dịch của 1 artwork, sắp xếp mới nhất trước.
   * Dùng OFFSET pagination — an toàn cho < 1M rows/artwork.
   */
  async getTradeHistory(
    artworkId: string,
    limit  = 50,
    offset = 0,
  ): Promise<TradeRow[]> {
    const result = await this.ch.query({
      query: `
        SELECT
          artwork_id, tx_hash, user_id, tx_type,
          toString(share_amount)    AS share_amount,
          toString(eth_amount)      AS eth_amount,
          toString(price_per_share) AS price_per_share,
          toString(gas_fee)         AS gas_fee,
          block_number,
          timestamp
        FROM trades
        WHERE artwork_id = {artwork_id: UUID}
        ORDER BY timestamp DESC
        LIMIT  {limit:  UInt32}
        OFFSET {offset: UInt32}
      `,
      query_params: { artwork_id: artworkId, limit, offset },
      format: 'JSONEachRow',
    });

    const rows = await result.json<TradeRow>();
    return rows;
  }

  /**
   * Đếm tổng số trade rows của 1 artwork — dùng cho pagination wrapper.
   */
  async countTradeHistory(artworkId: string): Promise<number> {
    const result = await this.ch.query({
      query: `
        SELECT count() AS cnt
        FROM trades
        WHERE artwork_id = {artwork_id: UUID}
      `,
      query_params: { artwork_id: artworkId },
      format: 'JSONEachRow',
    });
    const rows = await result.json<{ cnt: string }>();
    return parseInt(rows[0]?.cnt ?? '0', 10);
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  WRITE  —  Chỉ Consumer mới được gọi
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * [CONSUMER ONLY] Insert 1 trade row.
   * async_insert=1 → ClickHouse tự gom batch, không insert từng row.
   */
  async insertTrade(row: TradeRow): Promise<void> {
    await this.ch.insert({
      table:  'trades',
      values: [{
        ...row,
        timestamp: row.timestamp.toISOString().replace('T', ' ').substring(0, 19),
      }],
      format: 'JSONEachRow',
    });
  }

  /**
   * [CONSUMER ONLY] Batch insert — dùng cho re-sync hoặc backfill.
   */
  async insertTrades(rows: TradeRow[]): Promise<void> {
    if (!rows.length) return;
    await this.ch.insert({
      table:  'trades',
      values: rows.map(r => ({
        ...r,
        timestamp: r.timestamp.toISOString().replace('T', ' ').substring(0, 19),
      })),
      format: 'JSONEachRow',
    });
    this.logger.log(`[CH] Batch inserted ${rows.length} trades`);
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  ANALYTICS  —  Leaderboard & Stats
  // ══════════════════════════════════════════════════════════════════════════

  /** Volume 24h của 1 artwork (fallback khi Redis cache miss) */
  async getVolume24h(artworkId: string): Promise<string> {
    const from = new Date(Date.now() - 86_400_000);
    const result = await this.ch.query({
      query: `
        SELECT toString(sumMerge(volume_eth)) AS volume
        FROM volume_daily
        WHERE artwork_id = {artwork_id: UUID}
          AND day >= {from: Date}
        GROUP BY artwork_id
      `,
      query_params: {
        artwork_id: artworkId,
        from:       from.toISOString().substring(0, 10),
      },
      format: 'JSONEachRow',
    });
    const rows = await result.json<{ volume: string }>();
    return rows[0]?.volume ?? '0';
  }

  /** Top N artworks theo volume 7 ngày — cho leaderboard trang chủ */
  async getTopByVolume(limit = 20): Promise<{ artwork_id: string; volume_eth: string; trade_count: string }[]> {
    const from = new Date(Date.now() - 7 * 86_400_000);
    const result = await this.ch.query({
      query: `
        SELECT
          artwork_id,
          toString(sumMerge(volume_eth))    AS volume_eth,
          toString(countMerge(trade_count)) AS trade_count
        FROM volume_daily
        WHERE day >= {from: Date}
        GROUP BY artwork_id
        ORDER BY sumMerge(volume_eth) DESC
        LIMIT {limit: UInt32}
      `,
      query_params: { from: from.toISOString().substring(0, 10), limit },
      format: 'JSONEachRow',
    });
    return result.json();
  }

  /** Health check */
  async ping(): Promise<boolean> {
    try {
      await this.ch.ping();
      return true;
    } catch {
      return false;
    }
  }
}
