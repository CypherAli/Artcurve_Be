-- ============================================================
-- ArtCurve Analytics Schema — ClickHouse
-- Rule: Low cardinality columns truoc trong ORDER BY
-- Rule: Partition by month de prune data cu hieu qua
-- Rule: Dung AggregatingMergeTree cho Materialized Views
-- ============================================================

-- ── 1. BANG TRADES (Source of Truth) ────────────────────────────────────────
-- MergeTree — append-only, toi uu cho time-series insert
-- ORDER BY (artwork_id, timestamp): artwork_id la filter chinh cua moi query

CREATE TABLE IF NOT EXISTS trades (
    -- IDs
    artwork_id      UUID                        NOT NULL,
    tx_hash         String                      NOT NULL,
    user_id         UUID                        NOT NULL,

    -- Trade data
    tx_type         Enum8('buy'=1, 'sell'=2)    NOT NULL,
    share_amount    Decimal(18, 8)              NOT NULL,
    eth_amount      Decimal(18, 8)              NOT NULL,
    price_per_share Decimal(18, 8)              NOT NULL,
    gas_fee         Decimal(18, 8)              DEFAULT 0,

    -- Block info
    block_number    UInt64                      NOT NULL,
    timestamp       DateTime                    NOT NULL,

    -- Metadata (de-normalized de tranh JOIN trong analytics)
    inserted_at     DateTime                    DEFAULT now()
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(timestamp)
ORDER BY (artwork_id, timestamp, tx_hash)
SETTINGS index_granularity = 8192;

-- ── 2. OHLCV TARGET TABLES (AggregatingMergeTree) ───────────────────────────
-- Rule: AggregatingMergeTree luu trang thai aggregate, KHONG luu raw values
-- Query bang: argMinMerge(), maxMerge(), minMerge(), argMaxMerge(), sumMerge()

-- 1-minute candles
CREATE TABLE IF NOT EXISTS ohlcv_1m (
    artwork_id  UUID        NOT NULL,
    bucket      DateTime    NOT NULL,   -- toStartOfMinute(timestamp)
    open        AggregateFunction(argMin, Decimal(18,8), DateTime),
    high        AggregateFunction(max,    Decimal(18,8)),
    low         AggregateFunction(min,    Decimal(18,8)),
    close       AggregateFunction(argMax, Decimal(18,8), DateTime),
    volume      AggregateFunction(sum,    Decimal(18,8)),
    trade_count AggregateFunction(count)
)
ENGINE = AggregatingMergeTree()
PARTITION BY toYYYYMM(bucket)
ORDER BY (artwork_id, bucket);

-- 5-minute candles
CREATE TABLE IF NOT EXISTS ohlcv_5m (
    artwork_id  UUID        NOT NULL,
    bucket      DateTime    NOT NULL,   -- toStartOfFiveMinutes(timestamp)
    open        AggregateFunction(argMin, Decimal(18,8), DateTime),
    high        AggregateFunction(max,    Decimal(18,8)),
    low         AggregateFunction(min,    Decimal(18,8)),
    close       AggregateFunction(argMax, Decimal(18,8), DateTime),
    volume      AggregateFunction(sum,    Decimal(18,8)),
    trade_count AggregateFunction(count)
)
ENGINE = AggregatingMergeTree()
PARTITION BY toYYYYMM(bucket)
ORDER BY (artwork_id, bucket);

-- 1-hour candles
CREATE TABLE IF NOT EXISTS ohlcv_1h (
    artwork_id  UUID        NOT NULL,
    bucket      DateTime    NOT NULL,   -- toStartOfHour(timestamp)
    open        AggregateFunction(argMin, Decimal(18,8), DateTime),
    high        AggregateFunction(max,    Decimal(18,8)),
    low         AggregateFunction(min,    Decimal(18,8)),
    close       AggregateFunction(argMax, Decimal(18,8), DateTime),
    volume      AggregateFunction(sum,    Decimal(18,8)),
    trade_count AggregateFunction(count)
)
ENGINE = AggregatingMergeTree()
PARTITION BY toYYYYMM(bucket)
ORDER BY (artwork_id, bucket);

-- ── 3. MATERIALIZED VIEWS ────────────────────────────────────────────────────
-- Rule: MV tu dong tinh toan khi co INSERT vao trades
-- Khong ai query bang trades truc tiep — chi query ohlcv_1m/5m/1h

-- MV -> ohlcv_1m
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_ohlcv_1m
TO ohlcv_1m AS
SELECT
    artwork_id,
    toStartOfMinute(timestamp)          AS bucket,
    argMinState(price_per_share, timestamp) AS open,
    maxState(price_per_share)               AS high,
    minState(price_per_share)               AS low,
    argMaxState(price_per_share, timestamp) AS close,
    sumState(eth_amount)                    AS volume,
    countState()                            AS trade_count
FROM trades
GROUP BY artwork_id, bucket;

-- MV -> ohlcv_5m
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_ohlcv_5m
TO ohlcv_5m AS
SELECT
    artwork_id,
    toStartOfFiveMinutes(timestamp)     AS bucket,
    argMinState(price_per_share, timestamp) AS open,
    maxState(price_per_share)               AS high,
    minState(price_per_share)               AS low,
    argMaxState(price_per_share, timestamp) AS close,
    sumState(eth_amount)                    AS volume,
    countState()                            AS trade_count
FROM trades
GROUP BY artwork_id, bucket;

-- MV -> ohlcv_1h
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_ohlcv_1h
TO ohlcv_1h AS
SELECT
    artwork_id,
    toStartOfHour(timestamp)            AS bucket,
    argMinState(price_per_share, timestamp) AS open,
    maxState(price_per_share)               AS high,
    minState(price_per_share)               AS low,
    argMaxState(price_per_share, timestamp) AS close,
    sumState(eth_amount)                    AS volume,
    countState()                            AS trade_count
FROM trades
GROUP BY artwork_id, bucket;

-- ── 4. VOLUME STATS VIEW ─────────────────────────────────────────────────────
-- Pre-computed volume cho leaderboard (ClickHouse backup cho Redis)

CREATE TABLE IF NOT EXISTS volume_daily (
    artwork_id  UUID        NOT NULL,
    day         Date        NOT NULL,
    volume_eth  AggregateFunction(sum, Decimal(18,8)),
    trade_count AggregateFunction(count)
)
ENGINE = AggregatingMergeTree()
PARTITION BY toYYYYMM(day)
ORDER BY (artwork_id, day);

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_volume_daily
TO volume_daily AS
SELECT
    artwork_id,
    toDate(timestamp)       AS day,
    sumState(eth_amount)    AS volume_eth,
    countState()            AS trade_count
FROM trades
GROUP BY artwork_id, day;
