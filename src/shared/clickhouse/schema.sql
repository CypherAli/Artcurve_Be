-- ═════════════════════════════════════════════════════════════════════════════
--  ArtCurve — ClickHouse Schema
--  Engine : ClickHouse 23.x+
--  DB     : artcurve_analytics
--
--  Tất cả bảng dùng UInt256 cho giá trị wei (tránh float precision loss).
--  Materialized Views tự động pre-compute OHLCV khi có INSERT vào trades.
--  Thứ tự CREATE bắt buộc: backing table → MV (MV phụ thuộc backing table).
-- ═════════════════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────────────────
--  1. TRADES  —  Nguồn gốc của mọi analytics
-- ─────────────────────────────────────────────────────────────────────────────
--
--  ReplacingMergeTree: tự deduplicate theo tx_hash (không ghi dup khi catch-up).
--  PARTITION BY toYYYYMM(timestamp): monthly partition, TTL prune hiệu quả.
--  ORDER BY (artwork_id, timestamp, tx_hash): tối ưu cho range scan theo artwork.
--
CREATE TABLE IF NOT EXISTS trades
(
    artwork_id      UUID                              COMMENT 'UUID artwork trong PostgreSQL',
    tx_hash         FixedString(66)                   COMMENT '0x + 64 hex chars',
    user_id         UUID                              COMMENT 'UUID user trong PostgreSQL',
    tx_type         Enum8('buy' = 1, 'sell' = 2)     COMMENT 'Loại giao dịch',
    share_amount    UInt256                           COMMENT 'Số shares (không phải ETH)',
    eth_amount      UInt256                           COMMENT 'ETH thực trước fee (wei)',
    price_per_share UInt256                           COMMENT 'Giá 1 share tại thời điểm trade (wei)',
    gas_fee         UInt256                           COMMENT 'Gas fee (wei)',
    block_number    UInt64                            COMMENT 'Block number on-chain',
    timestamp       DateTime                          COMMENT 'UTC timestamp của block'
)
ENGINE = ReplacingMergeTree()
PARTITION BY toYYYYMM(timestamp)
ORDER BY (artwork_id, timestamp, tx_hash)
TTL timestamp + INTERVAL 2 YEAR
SETTINGS index_granularity = 8192;


-- ─────────────────────────────────────────────────────────────────────────────
--  2. OHLCV 1-MINUTE
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ohlcv_1m
(
    artwork_id  UUID,
    bucket      DateTime                                         COMMENT 'toStartOfMinute(timestamp)',
    open        AggregateFunction(argMin,  UInt256, DateTime)   COMMENT 'Giá mở cửa (giá của trade đầu tiên trong bucket)',
    high        AggregateFunction(max,     UInt256)             COMMENT 'Giá cao nhất',
    low         AggregateFunction(min,     UInt256)             COMMENT 'Giá thấp nhất',
    close       AggregateFunction(argMax,  UInt256, DateTime)   COMMENT 'Giá đóng cửa (trade cuối)',
    volume      AggregateFunction(sum,     UInt256)             COMMENT 'Tổng ETH (wei) trong bucket',
    trade_count AggregateFunction(count)                        COMMENT 'Số lượng trades'
)
ENGINE = AggregatingMergeTree()
PARTITION BY toYYYYMM(bucket)
ORDER BY (artwork_id, bucket)
SETTINGS index_granularity = 8192;

CREATE MATERIALIZED VIEW IF NOT EXISTS ohlcv_1m_mv TO ohlcv_1m
AS SELECT
    artwork_id,
    toStartOfMinute(timestamp)                  AS bucket,
    argMinState(price_per_share,  timestamp)    AS open,
    maxState(price_per_share)                   AS high,
    minState(price_per_share)                   AS low,
    argMaxState(price_per_share,  timestamp)    AS close,
    sumState(eth_amount)                        AS volume,
    countState()                                AS trade_count
FROM trades
GROUP BY artwork_id, bucket;


-- ─────────────────────────────────────────────────────────────────────────────
--  3. OHLCV 5-MINUTE
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ohlcv_5m
(
    artwork_id  UUID,
    bucket      DateTime,
    open        AggregateFunction(argMin,  UInt256, DateTime),
    high        AggregateFunction(max,     UInt256),
    low         AggregateFunction(min,     UInt256),
    close       AggregateFunction(argMax,  UInt256, DateTime),
    volume      AggregateFunction(sum,     UInt256),
    trade_count AggregateFunction(count)
)
ENGINE = AggregatingMergeTree()
PARTITION BY toYYYYMM(bucket)
ORDER BY (artwork_id, bucket);

CREATE MATERIALIZED VIEW IF NOT EXISTS ohlcv_5m_mv TO ohlcv_5m
AS SELECT
    artwork_id,
    toStartOfFiveMinutes(timestamp)             AS bucket,
    argMinState(price_per_share,  timestamp)    AS open,
    maxState(price_per_share)                   AS high,
    minState(price_per_share)                   AS low,
    argMaxState(price_per_share,  timestamp)    AS close,
    sumState(eth_amount)                        AS volume,
    countState()                                AS trade_count
FROM trades
GROUP BY artwork_id, bucket;


-- ─────────────────────────────────────────────────────────────────────────────
--  4. OHLCV 15-MINUTE
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ohlcv_15m
(
    artwork_id  UUID,
    bucket      DateTime,
    open        AggregateFunction(argMin,  UInt256, DateTime),
    high        AggregateFunction(max,     UInt256),
    low         AggregateFunction(min,     UInt256),
    close       AggregateFunction(argMax,  UInt256, DateTime),
    volume      AggregateFunction(sum,     UInt256),
    trade_count AggregateFunction(count)
)
ENGINE = AggregatingMergeTree()
PARTITION BY toYYYYMM(bucket)
ORDER BY (artwork_id, bucket);

CREATE MATERIALIZED VIEW IF NOT EXISTS ohlcv_15m_mv TO ohlcv_15m
AS SELECT
    artwork_id,
    toStartOfFifteenMinutes(timestamp)          AS bucket,
    argMinState(price_per_share,  timestamp)    AS open,
    maxState(price_per_share)                   AS high,
    minState(price_per_share)                   AS low,
    argMaxState(price_per_share,  timestamp)    AS close,
    sumState(eth_amount)                        AS volume,
    countState()                                AS trade_count
FROM trades
GROUP BY artwork_id, bucket;


-- ─────────────────────────────────────────────────────────────────────────────
--  5. OHLCV 1-HOUR
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ohlcv_1h
(
    artwork_id  UUID,
    bucket      DateTime,
    open        AggregateFunction(argMin,  UInt256, DateTime),
    high        AggregateFunction(max,     UInt256),
    low         AggregateFunction(min,     UInt256),
    close       AggregateFunction(argMax,  UInt256, DateTime),
    volume      AggregateFunction(sum,     UInt256),
    trade_count AggregateFunction(count)
)
ENGINE = AggregatingMergeTree()
PARTITION BY toYYYYMM(bucket)
ORDER BY (artwork_id, bucket);

CREATE MATERIALIZED VIEW IF NOT EXISTS ohlcv_1h_mv TO ohlcv_1h
AS SELECT
    artwork_id,
    toStartOfHour(timestamp)                    AS bucket,
    argMinState(price_per_share,  timestamp)    AS open,
    maxState(price_per_share)                   AS high,
    minState(price_per_share)                   AS low,
    argMaxState(price_per_share,  timestamp)    AS close,
    sumState(eth_amount)                        AS volume,
    countState()                                AS trade_count
FROM trades
GROUP BY artwork_id, bucket;


-- ─────────────────────────────────────────────────────────────────────────────
--  6. OHLCV 4-HOUR
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ohlcv_4h
(
    artwork_id  UUID,
    bucket      DateTime,
    open        AggregateFunction(argMin,  UInt256, DateTime),
    high        AggregateFunction(max,     UInt256),
    low         AggregateFunction(min,     UInt256),
    close       AggregateFunction(argMax,  UInt256, DateTime),
    volume      AggregateFunction(sum,     UInt256),
    trade_count AggregateFunction(count)
)
ENGINE = AggregatingMergeTree()
PARTITION BY toYYYYMM(bucket)
ORDER BY (artwork_id, bucket);

CREATE MATERIALIZED VIEW IF NOT EXISTS ohlcv_4h_mv TO ohlcv_4h
AS SELECT
    artwork_id,
    toStartOfInterval(timestamp, INTERVAL 4 HOUR) AS bucket,
    argMinState(price_per_share,  timestamp)       AS open,
    maxState(price_per_share)                      AS high,
    minState(price_per_share)                      AS low,
    argMaxState(price_per_share,  timestamp)       AS close,
    sumState(eth_amount)                           AS volume,
    countState()                                   AS trade_count
FROM trades
GROUP BY artwork_id, bucket;


-- ─────────────────────────────────────────────────────────────────────────────
--  7. OHLCV 1-DAY
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ohlcv_1d
(
    artwork_id  UUID,
    bucket      DateTime,
    open        AggregateFunction(argMin,  UInt256, DateTime),
    high        AggregateFunction(max,     UInt256),
    low         AggregateFunction(min,     UInt256),
    close       AggregateFunction(argMax,  UInt256, DateTime),
    volume      AggregateFunction(sum,     UInt256),
    trade_count AggregateFunction(count)
)
ENGINE = AggregatingMergeTree()
PARTITION BY toYear(bucket)
ORDER BY (artwork_id, bucket);

CREATE MATERIALIZED VIEW IF NOT EXISTS ohlcv_1d_mv TO ohlcv_1d
AS SELECT
    artwork_id,
    toStartOfDay(timestamp)                     AS bucket,
    argMinState(price_per_share,  timestamp)    AS open,
    maxState(price_per_share)                   AS high,
    minState(price_per_share)                   AS low,
    argMaxState(price_per_share,  timestamp)    AS close,
    sumState(eth_amount)                        AS volume,
    countState()                                AS trade_count
FROM trades
GROUP BY artwork_id, bucket;


-- ─────────────────────────────────────────────────────────────────────────────
--  8. VOLUME DAILY  —  Leaderboard & 24h volume stats
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS volume_daily
(
    artwork_id  UUID,
    day         Date                             COMMENT 'toDate(timestamp)',
    volume_eth  AggregateFunction(sum,   UInt256) COMMENT 'Tổng ETH giao dịch trong ngày',
    trade_count AggregateFunction(count)          COMMENT 'Số lượng trades trong ngày'
)
ENGINE = AggregatingMergeTree()
PARTITION BY toYear(day)
ORDER BY (artwork_id, day);

CREATE MATERIALIZED VIEW IF NOT EXISTS volume_daily_mv TO volume_daily
AS SELECT
    artwork_id,
    toDate(timestamp)   AS day,
    sumState(eth_amount) AS volume_eth,
    countState()         AS trade_count
FROM trades
GROUP BY artwork_id, day;
