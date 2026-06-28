# Database Migrations

## Naming Convention

```
{timestamp}-{CamelCaseName}.ts
```

- Timestamp: Unix milliseconds (e.g., `1715000001000`)
- Name: Descriptive CamelCase (e.g., `CreateArtworksTable`, `AddImageUriToArtworks`)

## Creating a New Migration

```bash
# Option 1: Manual (recommended)
# Create file: src/database/migrations/{timestamp}-{Name}.ts

# Option 2: TypeORM CLI
npx ts-node -r tsconfig-paths/register ./node_modules/typeorm/cli.js migration:create src/database/migrations/{Name}
```

## Running Migrations

Migrations run automatically on app start (`migrationsRun: true` in `database.module.ts`).

```bash
# Manual run
npx ts-node -r tsconfig-paths/register ./node_modules/typeorm/cli.js migration:run -d src/database/data-source.ts

# Revert last migration
npx ts-node -r tsconfig-paths/register ./node_modules/typeorm/cli.js migration:revert -d src/database/data-source.ts
```

## Migration Template

```typescript
import { MigrationInterface, QueryRunner } from 'typeorm';

export class MyMigration1715000099000 implements MigrationInterface {
  name = 'MyMigration1715000099000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE my_table ADD COLUMN new_col VARCHAR(255)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE my_table DROP COLUMN IF EXISTS new_col
    `);
  }
}
```

## Migration History

| # | Timestamp | Name | Description |
|---|-----------|------|-------------|
| 1 | 1715000000000 | CreateUsersTable | Users with wallet_address, username, role |
| 2 | 1715000001000 | CreateArtworksTable | Artworks with status enum, bonding curve fields |
| 3 | 1715000002000 | CreateTransactionsTable | Trade transactions (BUY/SELL/MINT/GRADUATE) |
| 4 | 1715000003000 | CreatePortfolioHoldingsTable | User holdings per artwork |
| 5 | 1715000004000 | CreateFollowersTable | Follow relationships |
| 6 | 1715000005000 | CreateSocialInteractionsTable | Likes, comments, reviews |
| 7 | 1715000006000 | CreateModerationLogsTable | AI moderation audit trail |
| 8 | 1715000007000 | AddArtworkMetaColumns | ticker, category, royalty_pct, curve_type, init_price |
| 9 | 1715000008000 | RemoveUserNonce | Remove nonce column (moved to Redis) |
| 10 | 1715000009000 | AddRatingToSocialInteractions | 1-5 star rating on reviews |
| 11 | 1715000010000 | CreateLiveStreamsTable | LiveKit streaming rooms |
| 12 | 1715000011000 | AddImageUriToArtworks | Direct IPFS image URI caching |
| 13 | 1715000012000 | CreateNotificationsTable | In-app notifications |
| 14 | 1715000013000 | AddLanguageToUsers | User language preference |
| 15 | 1715000014000 | AddAmmAddressAndOnchainIdToArtworks | AMM contract address mapping |
| 16 | 1715000015000 | DropDuplicateUniqueIndexes | Dedup cleanup |
| 17 | 1715000016000 | CreateUserWalletsTable | Multi-wallet support (SIWE linked) |
| 18 | 1715000017000 | AddMissingIndexes | Performance indexes |
| 19 | 1715000018000 | CreateGuildTables | Guild, members, messages, announcements, invites |
| 20 | 1718380000000 | CreateChatTables | AI chat sessions, messages, escalation tickets |
| 21 | 1718390000000 | AddKeysetIndexes | Keyset pagination indexes |
| 22 | 1718400000000 | AddGuildFinderColumns | Guild discovery fields |
| 23 | 1718410000000 | AddArtworkTypeColumn | artwork_type enum (ORIGINAL/AI_GENERATED/AI_ASSISTED) |
| 24 | 1718420000000 | CreateSecurityEventsTable | Security audit log |
