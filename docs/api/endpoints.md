# API Endpoints Reference

Base URL: `/api/v1`  
Interactive Docs: `GET /api/docs` (Swagger UI, development only)

## Auth

| Method | Path | Auth | Rate Limit | Description |
|--------|------|------|-----------|-------------|
| `POST` | `/auth/nonce` | Public | 10/min | Request SIWE nonce for wallet signing |
| `POST` | `/auth/verify` | Public | 5/min + brute force | Submit signature, receive JWT |
| `POST` | `/auth/logout` | JWT | Global | Revoke current JWT (Redis blacklist) |
| `GET` | `/auth/github` | Public | Global | GitHub OAuth redirect |
| `GET` | `/auth/twitter` | Public | Global | Twitter OAuth redirect |
| `GET` | `/auth/telegram` | Public | Global | Telegram OAuth redirect |

## Artworks

| Method | Path | Auth | Rate Limit | Description |
|--------|------|------|-----------|-------------|
| `GET` | `/artworks` | Public | Global | Marketplace listing (sortBy: price, created_at, view_count, trending) |
| `GET` | `/artworks/search` | Public | Global | Full-text search + category/curve_type/artwork_type filter |
| `GET` | `/artworks/my` | JWT | Global | Creator's own artworks (all statuses) |
| `GET` | `/artworks/stats` | Public | Global | Platform stats (artwork count, total volume, collectors) |
| `GET` | `/artworks/:id` | Public | Global | Artwork detail + creator info |
| `GET` | `/artworks/:id/ohlcv` | Public | Global | OHLCV candles (ClickHouse MV) |
| `GET` | `/artworks/:id/history` | Public | Global | Trade history paginated |
| `POST` | `/artworks/upload` | JWT | 1/30min | Upload image to IPFS (Pinata), get image_uri + metadata_uri |
| `POST` | `/artworks` | JWT | 1/30min | Create DRAFT artwork |
| `PATCH` | `/artworks/:id/status` | JWT | Global | State machine transition |
| `POST` | `/artworks/:id/view` | Public | Global | Increment view count (fire-and-forget) |

## Trades

| Method | Path | Auth | Rate Limit | Description |
|--------|------|------|-----------|-------------|
| `GET` | `/trades/:artworkId/ohlcv` | Public | Global | OHLCV candles (timeframe: 1m, 5m, 15m, 1h, 4h, 1d) |
| `GET` | `/trades/:artworkId/history` | Public | Global | Raw trade history (ClickHouse) |
| `GET` | `/trades/:artworkId/volume` | Public | Global | 24h volume in ETH |
| `GET` | `/trades/leaderboard` | Public | Global | Top artworks by volume (7d) |
| `GET` | `/trades/recent` | Public | Global | Recent trades across platform (activity feed) |

## Portfolio

| Method | Path | Auth | Rate Limit | Description |
|--------|------|------|-----------|-------------|
| `GET` | `/portfolio/me/pnl` | JWT | Global | Portfolio P&L with unrealized gains (Decimal.js) |
| `GET` | `/portfolio/me/holdings/:artworkId` | JWT | Global | Holding for specific artwork |
| `GET` | `/portfolio/artworks/:artworkId/holders` | JWT | Global | Top holders leaderboard (RANK window function) |

## Users

| Method | Path | Auth | Rate Limit | Description |
|--------|------|------|-----------|-------------|
| `GET` | `/users/me` | JWT | Global | Current user profile |
| `PATCH` | `/users/me` | JWT | Global | Update profile (username, bio, avatar, twitter) |
| `GET` | `/users/top-creators` | Public | Global | Top creators by artwork count |
| `GET` | `/users/:walletAddress` | Public | Global | Public profile by wallet address |

## Social

| Method | Path | Auth | Rate Limit | Description |
|--------|------|------|-----------|-------------|
| `POST` | `/social/follow/:userId` | JWT | Global | Follow a user |
| `DELETE` | `/social/follow/:userId` | JWT | Global | Unfollow a user |
| `GET` | `/social/followers/:userId` | Public | Global | User's followers list |
| `GET` | `/social/following/:userId` | Public | Global | Users being followed |
| `POST` | `/social/like/:artworkId` | JWT | Global | Like an artwork |
| `DELETE` | `/social/like/:artworkId` | JWT | Global | Unlike an artwork |
| `GET` | `/social/likes/:artworkId/count` | Public | Global | Like count |
| `POST` | `/social/comment/:artworkId` | JWT | Global | Post comment/review (optional 1-5 star rating) |
| `GET` | `/social/comments/:artworkId` | Public | Global | Comments paginated |
| `DELETE` | `/social/comment/:commentId` | JWT | Global | Delete own comment |
| `GET` | `/social/stats/:artworkId` | Public | Global | Likes + comments + avg rating |

## Live Streaming

| Method | Path | Auth | Rate Limit | Description |
|--------|------|------|-----------|-------------|
| `POST` | `/live/create` | JWT | Global | Create LiveKit room, get host token |
| `GET` | `/live` | Public | Global | List active streams |
| `GET` | `/live/:roomName` | Public | Global | Stream info |
| `GET` | `/live/:roomName/viewer-token` | Public | Global | Viewer JWT for LiveKit |
| `DELETE` | `/live/:roomName` | JWT | Global | End stream (host only) |
| `POST` | `/live/webhook` | Public | Global | LiveKit Cloud webhook (viewer_count sync) |

## Health & Admin

| Method | Path | Auth | Rate Limit | Description |
|--------|------|------|-----------|-------------|
| `GET` | `/health` | Public | Global | Basic health check |
| `GET` | `/health/security` | Public | Global | Recent 10 security events |
| `GET` | `/health/backup` | Public | Global | Backup status |
| `POST` | `/health/backup/run` | JWT | Global | Trigger manual backup |

## Global Rate Limit

All endpoints not listed with a specific rate limit are subject to the global default of **120 requests/minute** per IP.
