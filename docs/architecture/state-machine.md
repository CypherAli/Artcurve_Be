# Artwork Lifecycle State Machine

> DRAFT → AI_MODERATING → ACTIVE → TARGET_REACHED → GRADUATED

## State Diagram

```
                    Upload file
                        │
                        ▼
                    ┌───────┐
                    │ DRAFT │  ← Metadata saved to PostgreSQL
                    └───┬───┘
                        │ Creator submits for review
                        ▼
               ┌────────────────┐
               │ AI_MODERATING  │  ← AI content moderation (NSFW check)
               └───────┬────────┘
                        │
          ┌─────────────┴──────────────┐
          │ score <= threshold          │ score > threshold
          ▼                             ▼
    ┌────────┐                    ┌──────────┐
    │ ACTIVE │                    │ REJECTED │ (logged to moderation_logs)
    └───┬────┘
        │ current_supply == target_cap
        ▼
┌──────────────────┐
│  TARGET_REACHED  │  ← vAMM trading paused
└────────┬─────────┘
         │ migrateLiquidity() on-chain
         ▼
   ┌──────────────┐
   │  GRADUATED   │  ← Liquidity migrated to Uniswap, LP tokens burned
   └──────────────┘
```

## State Descriptions

### DRAFT
- **Entry**: Creator uploads artwork image to IPFS (via Pinata) and fills metadata (title, description, category, bonding curve parameters).
- **What's stored**: Artwork entity in PostgreSQL with `status = 'DRAFT'`. Image and metadata URIs point to IPFS.
- **Who can trigger transition**: The creator, by submitting the artwork for review via `PATCH /artworks/:id/status`.
- **Guard conditions**: Title, description, image_uri, and metadata_uri must all be non-empty.

### AI_MODERATING
- **Entry**: Automatic upon submission. The system sends the artwork image to the AI moderation service for NSFW content analysis.
- **What happens**: AI returns a confidence score (0-100). Results are logged in `moderation_logs` with `ai_confidence_score` and `action_taken`.
- **Transition to ACTIVE**: Score is at or below the configured threshold — artwork is approved.
- **Transition to REJECTED**: Score exceeds threshold — artwork is flagged. The `moderation_logs` entry records `action_taken = 'REJECTED'` with the reason.
- **Who can trigger**: Automated — no manual intervention needed. Admins can also manually override via `action_taken = 'MANUAL_REVIEW'`.

### ACTIVE
- **Entry**: Artwork passes moderation. The smart contract (BondingCurveAMM) is deployed on-chain via ArtFactory. `contract_address` is set on the artwork entity.
- **What happens**: Shares are tradeable. Users buy/sell via the bonding curve. Price and supply update in real-time.
- **Guard condition for next transition**: `current_supply >= target_cap` — the artwork has reached its funding target.
- **Who triggers**: Automatic when the blockchain indexer detects the supply has reached the target.

### TARGET_REACHED
- **Entry**: The bonding curve supply equals the target cap. Trading on the vAMM is paused.
- **What happens**: The system prepares for liquidity migration. No new trades are accepted on the bonding curve.
- **Who triggers next**: The contract owner (or automated keeper) calls `migrateLiquidity()` on-chain.

### GRADUATED
- **Entry**: Liquidity has been migrated from the bonding curve to a Uniswap V2/V3 pool. LP tokens are burned.
- **What happens**: The artwork token now trades freely on Uniswap. The ArtCurve platform continues to display it but trading happens on the DEX.
- **Terminal state**: No further transitions.

## Database Enum

```sql
CREATE TYPE artwork_status AS ENUM (
  'DRAFT',
  'AI_MODERATING',
  'ACTIVE',
  'TARGET_REACHED',
  'GRADUATED'
);
```

## API Transition Endpoint

```
PATCH /api/v1/artworks/:id/status
Authorization: Bearer <JWT>
Body: { "status": "AI_MODERATING" }

Allowed transitions:
  DRAFT → AI_MODERATING       (creator only)
  AI_MODERATING → ACTIVE      (system / admin)
  AI_MODERATING → REJECTED    (system / admin)
  ACTIVE → TARGET_REACHED     (system — blockchain indexer)
  TARGET_REACHED → GRADUATED  (system — after migrateLiquidity tx)
```
