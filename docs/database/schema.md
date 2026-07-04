# ARTCURVE — Database Design Documentation

> NestJS + TypeORM + PostgreSQL | Inspired by pump.fun | Web3 Fractionalized Art Trading

---

## ERD — Entity Relationship Diagram

```
USERS ─────────────────────────────────────────────────────────────────────────
  id (uuid, PK)
  wallet_address (varchar(42), UNIQUE)          ← SIWE auth identifier
  nonce | username | email | bio | avatar_url
  twitter_handle | is_verified | role
  created_at | updated_at (timestamptz)

      │  1                    1 │
      │  ├──── creates ──────►  │
      ▼  N                    N ▼

ARTWORKS ──────────────────────────────────────────────────────────────────────
  id (uuid, PK)
  creator_id (uuid, FK → USERS)
  contract_address (varchar(42), UNIQUE, nullable)  ← Set after deploy
  title | description | ipfs_metadata_uri
  status (ENUM: DRAFT→AI_MODERATING→ACTIVE→TARGET_REACHED→GRADUATED)
  target_cap | current_supply | current_price  (DECIMAL 18,8)
  view_count | created_at | updated_at

      │  1                    1 │
      │  ├── has many ────────►  │
      ▼  N                    N ▼

TRANSACTIONS ──────────────────────────────────────────────────────────────────
  id (uuid, PK)
  tx_hash (varchar(66), UNIQUE)    ← Idempotency Key — chống ghi đúp RabbitMQ
  user_id (uuid, FK → USERS)
  artwork_id (uuid, FK → ARTWORKS)
  tx_type (ENUM: BUY | SELL | MINT | GRADUATE)
  share_amount | eth_amount | price_per_share | gas_fee  (DECIMAL 18,8)
  block_number (bigint) | timestamp (timestamptz)
  INDEX: idx_tx_history (artwork_id, timestamp DESC)

PORTFOLIO_HOLDINGS ────────────────────────────────────────────────────────────
  id (uuid, PK)
  user_id (uuid, FK → USERS)
  artwork_id (uuid, FK → ARTWORKS)
  share_balance | avg_buy_price  (DECIMAL 18,8)
  UNIQUE INDEX: idx_user_portfolio (user_id, artwork_id)  ← upsert conflict target

FOLLOWERS ─────────────────────────────────────────────────────────────────────
  id (uuid, PK)
  follower_id (uuid, FK → USERS)
  following_id (uuid, FK → USERS)
  UNIQUE INDEX: idx_follow (follower_id, following_id)
  CHECK: follower_id <> following_id  ← ngăn tự follow

SOCIAL_INTERACTIONS ───────────────────────────────────────────────────────────
  id (uuid, PK)
  user_id (uuid, FK → USERS)
  artwork_id (uuid, FK → ARTWORKS)
  interaction_type (LIKE | COMMENT | SHARE | BOOKMARK)
  content (nullable — chỉ COMMENT có nội dung)
  PARTIAL UNIQUE INDEX: (user_id, artwork_id) WHERE type='LIKE'  ← 1 like/artwork

MODERATION_LOGS ───────────────────────────────────────────────────────────────
  id (uuid, PK)
  artwork_id (uuid, FK → ARTWORKS)
  admin_id (uuid, FK → USERS, nullable)  ← null = AI auto-moderation
  ai_confidence_score (DECIMAL 5,2)  ← Google Vision NSFW score 0-100
  action_taken (APPROVED | REJECTED | FLAGGED | MANUAL_REVIEW)
  reason (nullable)
```

---

## State Machine — Artwork Lifecycle

```
                    Upload file
                        │
                        ▼
                    ┌───────┐
                    │ DRAFT │  ← Lưu metadata vào PostgreSQL
                    └───┬───┘
                        │ trigger moderation
                        ▼
               ┌────────────────┐
               │ AI_MODERATING  │  ← Google Vision API quét NSFW
               └───────┬────────┘
                        │
          ┌─────────────┴──────────────┐
          │ score <= threshold          │ score > threshold
          ▼                             ▼
    ┌────────┐                    ┌──────────┐
    │ ACTIVE │                    │ REJECTED │ (ghi moderation_log)
    └───┬────┘
        │ current_supply == target_cap
        ▼
┌──────────────────┐
│  TARGET_REACHED  │  ← Tạm ngưng vAMM
└────────┬─────────┘
         │ migrateLiquidity()
         ▼
   ┌──────────────┐
   │  GRADUATED   │  ← Uniswap V2/V3, burn LP Token
   └──────────────┘
```

---

## Indexing Strategy

| Index | Bảng | Columns | Loại | Mục đích |
|-------|-------|---------|------|----------|
| `idx_users_wallet_address` | users | wallet_address | UNIQUE B-tree | Auth lookup |
| `idx_users_verified` | users | is_verified | Partial | Artist discovery |
| `idx_artworks_creator_id` | artworks | creator_id | B-tree | FK join |
| `idx_artworks_status` | artworks | status | B-tree | Status filter |
| `idx_artworks_active_price` | artworks | (status, current_price) | Partial | Marketplace sort |
| `idx_transactions_tx_hash` | transactions | tx_hash | UNIQUE B-tree | Idempotency check |
| `idx_tx_history` | transactions | (artwork_id, timestamp DESC) | Composite | Trade history |
| `idx_transactions_user_id` | transactions | user_id | B-tree | User tx lookup |
| `idx_user_portfolio` | portfolio_holdings | (user_id, artwork_id) | UNIQUE B-tree | Upsert + lookup |
| `idx_follow` | followers | (follower_id, following_id) | UNIQUE B-tree | Follow dedup |
| `idx_social_unique_like` | social_interactions | (user_id, artwork_id) | Partial UNIQUE | 1 like/artwork |
| `idx_social_artwork_type` | social_interactions | (artwork_id, type, created_at) | Composite | Comment feed |
| `idx_moderation_action_score` | moderation_logs | (action_taken, score) | Composite | Admin dashboard |

---

## Key Design Decisions (từ Skills)

### 1. DECIMAL(18,8) cho tất cả giá trị tài chính
```typescript
// ✅ ĐÚNG — theo postgres-schema-design skill
@Column({ type: 'decimal', precision: 18, scale: 8 })
current_price: string;  // TypeScript nhận về string để tránh JS floating point

// ❌ SAI — mất precision với số nhỏ như 0.000001 ETH
@Column({ type: 'float' })
current_price: number;
```

### 2. tx_hash là Idempotency Key (từ web3market-backend-patterns)
```sql
-- Blockchain indexer gửi lại event → không ghi đúp
INSERT INTO transactions (tx_hash, ...)
VALUES ($1, ...)
ON CONFLICT (tx_hash) DO NOTHING;
```

### 3. CREATE INDEX CONCURRENTLY (từ database-migrations skill)
```sql
-- Tất cả index trong migration dùng CONCURRENTLY để không block writes
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_tx_history"
ON "transactions" ("artwork_id", "timestamp" DESC);
```

### 4. Không dùng eager: true (từ typeorm-schema-optimizer)
```typescript
// ✅ Load relations khi cần thiết
const artwork = await artworkRepo.findOne({
  where: { id },
  relations: ['creator', 'transactions'], // explicit load
});

// ❌ eager: true load mọi lúc, gây N+1 ở scale
@OneToMany(() => Transaction, tx => tx.artwork, { eager: true })
```

### 5. timestamptz thay vì timestamp (từ postgres-schema-design)
```typescript
// ✅ ĐÚNG — lưu timezone, tránh lỗi DST
@CreateDateColumn({ type: 'timestamptz' })
created_at: Date;
```

---

## Migration Order (Dependency)

```
001-CreateUsersTable
    └── 002-CreateArtworksTable (FK → users)
            └── 003-CreateTransactionsTable (FK → users + artworks)
            └── 004-CreatePortfolioHoldingsTable (FK → users + artworks)
            └── 005-CreateFollowersTable (FK → users × 2)
            └── 006-CreateSocialInteractionsTable (FK → users + artworks)
            └── 007-CreateModerationLogsTable (FK → artworks + users)
```

---

## Cách chạy

```bash
# Install dependencies
npm install

# Copy env
cp .env.example .env
# Sửa DB_PASSWORD và các secrets trong .env

# Chạy migrations
npm run migration:run

# Xem trạng thái migrations
npm run migration:show

# Rollback migration cuối
npm run migration:revert
```

---

## Project Structure

```
artcurve-backend/
├── src/
│   ├── database/
│   │   ├── data-source.ts              ← TypeORM DataSource (CLI migrations)
│   │   ├── database.module.ts          ← NestJS DatabaseModule
│   │   ├── entities/
│   │   │   ├── index.ts
│   │   │   ├── user.entity.ts
│   │   │   ├── artwork.entity.ts
│   │   │   ├── transaction.entity.ts
│   │   │   ├── portfolio-holding.entity.ts
│   │   │   ├── follower.entity.ts
│   │   │   ├── social-interaction.entity.ts
│   │   │   └── moderation-log.entity.ts
│   │   └── migrations/
│   │       ├── 1715000000000-CreateUsersTable.ts
│   │       ├── 1715000001000-CreateArtworksTable.ts
│   │       ├── 1715000002000-CreateTransactionsTable.ts
│   │       ├── 1715000003000-CreatePortfolioHoldingsTable.ts
│   │       ├── 1715000004000-CreateFollowersTable.ts
│   │       ├── 1715000005000-CreateSocialInteractionsTable.ts
│   │       └── 1715000006000-CreateModerationLogsTable.ts
│   └── modules/
│       └── blockchain/
│           ├── blockchain-event.consumer.ts   ← Xử lý on-chain events
│           └── rabbitmq-blockchain.consumer.ts ← RabbitMQ listener
├── .env.example
├── package.json
└── docs/DATABASE_DESIGN.md
```
