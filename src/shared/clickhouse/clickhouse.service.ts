import { Injectable, Inject, Logger, BadRequestException } from '@nestjs/common';
import { ClickHouseClient } from '@clickhouse/client';
import { CLICKHOUSE_CLIENT } from './clickhouse.constants';

// ── Interfaces ────────────────────────────────────────────────────────────────

export interface TradeInsertRow {
  artwork_id:       string;
  tx_hash:          string;
  user_id:          string;
  tx_type:          'buy' | 'sell';
  share_amount:     string;
  eth_amount:       string;
  price_per_share:  string;
  gas_fee:          string;
  block_number:     number;
  timestamp:        Date;
}

export interface OhlcvCandle {
  bucket:      string;   // ISO datetime string
  open:        string;
  high:        string;
  low:         string;
  close:       string;
  volume:      string;
  trade_count: string;
}

export type OhlcvInterval = '1m' | '5m' | '1h';

export interface VolumeStats {
  artwork_id:   string;
  volume_eth:   string;
  trade_count:  string;
}

// ── ClickHouseService ─────────────────────────────────────────────────────────
//
// RULE: Chi RabbitMQ Consumer moi duoc goi insertTrade()
// API chi duoc dung getOhlcv(), getVolume24h(), getTopByVolume()

@Injectable()
export class ClickHouseService {
  private readonly logger = new Logger(ClickHouseService.name);

  constructor(
    @Inject(CLICKHOUSE_CLIENT)
    private readonly ch: ClickHouseClient,
  ) {}

  // ════════════════════════════════════════════════════════════════════════════
  // WRITE — Chi Consumer moi goi
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * [CONSUMER ONLY] Insert 1 trade vao ClickHouse.
   * Materialized Views tu dong tinh OHLCV trong background.
   *
   * Rule: async_insert = 1 — ClickHouse tu gom batch, khong insert tung row
   * Rule: format JSON cho toc do va type safety
   */
  async insertTrade(trade: TradeInsertRow): Promise<void> {
    await this.ch.insert({
      table:  'trades',
      values: [{
        artwork_id:       trade.artwork_id,
        tx_hash:          trade.tx_hash,
        user_id:          trade.user_id,
        tx_type:          trade.tx_type,
        share_amount:     trade.share_amount,
        eth_amount:       trade.eth_amount,
        price_per_share:  trade.price_per_share,
        gas_fee:          trade.gas_fee,
        block_number:     trade.block_number,
        timestamp:        trade.timestamp.toISOString().replace('T', ' ').substring(0, 19),
      }],
      format: 'JSONEachRow',
    });

    this.logger.debug(`[CH] Trade inserted: ${trade.tx_hash}`);
  }

  /**
   * Batch insert — dung khi can insert nhieu trades cung luc (e.g. re-sync)
   */
  async insertTrades(trades: TradeInsertRow[]): Promise<void> {
    if (!trades.length) return;

    await this.ch.insert({
      table:  'trades',
      values: trades.map(t => ({
        ...t,
        timestamp: t.timestamp.toISOString().replace('T', ' ').substring(0, 19),
      })),
      format: 'JSONEachRow',
    });

    this.logger.log(`[CH] Batch inserted ${trades.length} trades`);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // READ — API dung cac ham nay
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Lay OHLCV candles tu Materialized View (da tinh san, micro-giay).
   * Rule: KHONG query bang trades truc tiep — chi query ohlcv_1m/5m/1h
   *
   * Query dung -Merge suffix: argMinMerge(), maxMerge(), minMerge(), ...
   */
  async getOhlcv(
    artworkId: string,
    interval: OhlcvInterval,
    from: Date,
    to: Date,
    limit = 500,
  ): Promise<OhlcvCandle[]> {
    // Whitelist validation — chống SQL injection qua table name interpolation
    const ALLOWED_INTERVALS: Record<string, string> = {
      '1m': 'ohlcv_1m',
      '5m': 'ohlcv_5m',
      '1h': 'ohlcv_1h',
    };
    const table = ALLOWED_INTERVALS[interval];
    if (!table) {
      throw new BadRequestException(
        `Invalid interval "${interval}". Allowed: ${Object.keys(ALLOWED_INTERVALS).join(', ')}`,
      );
    }

    const result = await this.ch.query({
      query: `
        SELECT
          bucket,
          toString(argMinMerge(open))       AS open,
          toString(maxMerge(high))           AS high,
          toString(minMerge(low))            AS low,
          toString(argMaxMerge(close))       AS close,
          toString(sumMerge(volume))         AS volume,
          toString(countMerge(trade_count))  AS trade_count
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

    return result.json<OhlcvCandle>();
  }

  /**
   * Volume 24h cua 1 artwork — fallback khi Redis cache miss
   */
  async getVolume24h(artworkId: string): Promise<string> {
    const from = new Date(Date.now() - 24 * 3600 * 1000);

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

  /**
   * Top N artworks theo volume (7 ngay) — dung cho leaderboard trang chu
   */
  async getTopByVolume(limit = 20): Promise<VolumeStats[]> {
    const from = new Date(Date.now() - 7 * 24 * 3600 * 1000);

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
      query_params: {
        from:  from.toISOString().substring(0, 10),
        limit,
      },
      format: 'JSONEachRow',
    });

    return result.json<VolumeStats>();
  }

  /**
   * Lich su giao dich raw cua 1 artwork (cho trang detail)
   * Query truc tiep bang trades — chi dung cho paging co LIMIT
   */
  async getTradeHistory(
    artworkId: string,
    limit = 50,
    offset = 0,
  ): Promise<TradeInsertRow[]> {
    const result = await this.ch.query({
      query: `
        SELECT *
        FROM trades
        WHERE artwork_id = {artwork_id: UUID}
        ORDER BY timestamp DESC
        LIMIT {limit: UInt32}
        OFFSET {offset: UInt32}
      `,
      query_params: { artwork_id: artworkId, limit, offset },
      format: 'JSONEachRow',
    });

    return result.json<TradeInsertRow>();
  }

  async ping(): Promise<boolean> {
    try {
      await this.ch.ping();
      return true;
    } catch {
      return false;
    }
  }
}
