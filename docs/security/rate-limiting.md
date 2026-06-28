# Rate Limiting

## Strategy

Two layers of rate limiting protect the API:

1. **Global ThrottlerModule** — 120 requests/minute per IP (default)
2. **Per-endpoint @Throttle()** — Stricter limits on sensitive endpoints

## Endpoint Rate Limits

### Authentication

| Endpoint | Limit | Window | Purpose |
|----------|-------|--------|---------|
| POST /auth/nonce | 10 | 1 min | Anti-spam nonce generation |
| POST /auth/verify | 5 | 1 min | Anti-brute-force (+ BruteForceGuard) |
| GET /auth/google | 5 | 1 min | OAuth redirect |
| GET /auth/github | 5 | 1 min | OAuth redirect |
| POST /auth/twitter | 10 | 1 min | OAuth initiate |
| POST /auth/telegram | 5 | 1 min | Telegram auth |

### Artworks

| Endpoint | Limit | Window | Purpose |
|----------|-------|--------|---------|
| POST /artworks | 1 | 30 min | Prevent artwork spam |
| POST /artworks/upload | 1 | 30 min | Prevent upload spam |
| GET /artworks/:id/quote | 30 | 1 min | Anti-scraping |
| POST /artworks/:id/view | 10 | 1 min | Prevent view count inflation |

### Social

| Endpoint | Limit | Window | Purpose |
|----------|-------|--------|---------|
| POST /social/follow | 5 | 1 min | Anti-follow spam |
| DELETE /social/follow | 5 | 1 min | Anti-unfollow spam |
| POST /social/like | 10 | 1 min | Anti-like spam |
| POST /social/review | 5 | 1 min | Anti-review spam |

### Live Streaming

| Endpoint | Limit | Window | Purpose |
|----------|-------|--------|---------|
| POST /live/create | 3 | 1 hour | Prevent stream spam |
| POST /live/:room/viewer-token | 10 | 1 min | Token generation |
| POST /live/:room/chat | 30 | 1 min | Live chat messages |
| POST /live/:room/tip | 10 | 1 min | Tip transactions |

### Guild

| Endpoint | Limit | Window | Purpose |
|----------|-------|--------|---------|
| POST /guilds/ai/character-prompt | 10 | 1 min | AI API proxy rate limit |

## Brute Force Protection

Separate from rate limiting — tracks failed login attempts per IP.

```
Failed attempt #1-4 → Log WARNING, continue
Failed attempt #5   → Block IP for 30 minutes, log CRITICAL
```

### Redis Keys

```
security:failed_login:{ip}    → counter, TTL 15 minutes
security:blocked:{ip}         → "1", TTL 30 minutes
```

### Flow

```
Request → BruteForceGuard
             │
             ├── Is IP blocked? → YES → 403 Forbidden
             │
             └── NO → Continue to auth verify
                          │
                          ├── Success → Clear failed attempts
                          │
                          └── Failure → Increment counter
                                          │
                                          ├── Count < 5 → Log WARNING
                                          │
                                          └── Count >= 5 → Block IP 30min
                                                           Log CRITICAL
```

## Response on Rate Limit

```json
{
  "statusCode": 429,
  "message": "ThrottlerException: Too Many Requests"
}
```
