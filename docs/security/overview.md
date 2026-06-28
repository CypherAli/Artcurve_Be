# ArtCurve Backend — Security Documentation

## Threat Model

### Protected Attack Vectors

| Attack | Mitigation |
|--------|-----------|
| Credential stuffing / brute force | Per-IP failed login tracking (Redis), auto-block after 5 failures for 30 min |
| Session hijacking | Short-lived JWT (15min access), refresh token rotation, Redis blacklist |
| Replay attacks | SIWE nonce (single-use, expires 5min), stored in Redis |
| CSRF on OAuth | Random `state` token verified on callback |
| XSS / injection | Helmet security headers (CSP, X-Frame-Options), `ValidationPipe` with whitelist |
| DDoS / resource exhaustion | Per-endpoint rate limiting via `@nestjs/throttler`, global 120 req/min baseline |
| Artwork spam | 1 upload per 30 minutes per authenticated user |
| Price oracle scraping | Quote endpoint rate-limited to 30 req/min |
| Man-in-the-middle | HSTS enforced, DB and Redis SSL configurable |

### Out of Scope (handled elsewhere)

- Smart contract exploits: audited separately, not covered here
- Frontend XSS: handled by Next.js CSP and React's default escaping
- DNS hijacking: managed by Render/Vercel infrastructure

---

## Authentication Flow

### SIWE (Sign-In With Ethereum)

```
Client                        Backend                         Redis
  │                              │                              │
  ├── POST /auth/nonce ─────────►│                              │
  │   { wallet_address }         │── generate nonce ───────────►│
  │                              │   store(wallet:nonce, 5min)  │
  │◄── { nonce, message } ──────│                              │
  │                              │                              │
  │  [User signs message         │                              │
  │   via MetaMask/WalletConnect]│                              │
  │                              │                              │
  ├── POST /auth/verify ────────►│                              │
  │   { wallet, signature, msg } │── verify nonce ─────────────►│
  │                              │   delete(wallet:nonce)       │
  │                              │── check brute force ────────►│
  │                              │   incr(bf:IP) if failed      │
  │                              │                              │
  │                              │── verify SIWE signature      │
  │                              │── upsert user (PostgreSQL)   │
  │                              │── issue JWT (access+refresh) │
  │                              │── log security event ────────│
  │◄── { access_token, user } ──│                              │
```

### OAuth Flow (GitHub / Google / Twitter / Telegram)

```
Client                        Backend                    OAuth Provider
  │                              │                              │
  ├── GET /auth/{provider} ─────►│                              │
  │                              │── generate state token ─────►│ (Redis, 10min)
  │◄── 302 Redirect ────────────│── redirect to provider ─────►│
  │                              │                              │
  │── [User authorizes] ────────────────────────────────────────►│
  │                              │                              │
  │◄── GET /auth/{provider}/callback?code=X&state=Y ───────────│
  │                              │── verify state token         │
  │                              │── exchange code for profile ─►│
  │                              │── link to wallet or create   │
  │◄── { access_token, user } ──│                              │
```

### Token Lifecycle

```
Access Token (15 min)                Refresh Token (30 days)
  │                                    │
  ├── Used for all API requests        ├── Used only at POST /auth/refresh
  ├── Stateless verification           ├── Stored in HttpOnly cookie
  ├── Contains: sub, wallet, role      ├── One-time use (rotation)
  └── On expiry → use refresh token    └── On use → new access + new refresh
                                            old refresh → Redis blacklist
```

---

## Rate Limiting Strategy

### Implementation

Rate limiting uses `@nestjs/throttler` with Redis-backed storage for distributed consistency across multiple instances.

### Tiers

| Tier | Limit | Applied To |
|------|-------|-----------|
| **Strict** | 5 req/min | `/auth/verify` (login attempt) |
| **Auth** | 10 req/min | `/auth/nonce` (nonce generation) |
| **Create** | 1 req/30min | `POST /artworks`, `POST /artworks/upload` |
| **Read-sensitive** | 30 req/min | `/artworks/:id/quote` (price quotes) |
| **Global** | 120 req/min | All other endpoints |

### Headers Returned

```
X-RateLimit-Limit: 120
X-RateLimit-Remaining: 119
X-RateLimit-Reset: 1719648000
Retry-After: 60          # only on 429
```

---

## Brute Force Protection

### Flow

```
POST /auth/verify
  │
  ├── BruteForceGuard checks Redis key  bf:{client_ip}
  │     │
  │     ├── count >= 5 → 429 Too Many Requests
  │     │                 log BRUTE_FORCE_BLOCKED event
  │     │                 IP blocked for 30 minutes
  │     │
  │     └── count < 5 → proceed to verify
  │           │
  │           ├── signature valid → reset counter, log LOGIN_SUCCESS
  │           │
  │           └── signature invalid → increment counter (TTL 15min)
  │                                   log LOGIN_FAILED
```

### Redis Keys

| Key Pattern | TTL | Purpose |
|-------------|-----|---------|
| `bf:{ip}` | 15 min (sliding) | Failed attempt counter |
| `bf:block:{ip}` | 30 min | Block flag after 5 failures |

---

## Security Event Types

All events are persisted to the `security_events` PostgreSQL table.

| Event Type | Severity | Description |
|-----------|----------|-------------|
| `LOGIN_SUCCESS` | `info` | Successful SIWE or OAuth login |
| `LOGIN_FAILED` | `warning` | Invalid signature or expired nonce |
| `BRUTE_FORCE_BLOCKED` | `critical` | IP exceeded 5 failed attempts |
| `TOKEN_REVOKED` | `info` | User logout or refresh token rotation |
| `TOKEN_REFRESH` | `info` | Access token refreshed via refresh token |
| `OAUTH_LINK` | `info` | OAuth account linked to wallet |
| `RATE_LIMITED` | `warning` | Request rejected by rate limiter |

### Event Schema

```sql
CREATE TABLE security_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type    VARCHAR(50) NOT NULL,
  wallet_address VARCHAR(42),
  ip_address    VARCHAR(45),
  user_agent    TEXT,
  severity      VARCHAR(10) DEFAULT 'info',  -- info, warning, critical
  metadata      JSONB,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_security_events_type_created ON security_events(event_type, created_at DESC);
CREATE INDEX idx_security_events_ip ON security_events(ip_address, created_at DESC);
```

---

## Incident Response

### If a JWT secret is compromised

1. Rotate `JWT_SECRET` in Render dashboard immediately
2. Redeploy the service (all existing tokens become invalid)
3. No user data is at risk -- JWTs contain only `sub`, `wallet`, `role`
4. Monitor `security_events` for unusual `LOGIN_SUCCESS` patterns

### If the database is compromised

1. Rotate `DATABASE_URL` credentials in Render
2. Revoke the old PostgreSQL role: `ALTER ROLE old_user NOLOGIN;`
3. Check `security_events` for recent `LOGIN_SUCCESS` from unexpected IPs
4. Rotate `JWT_SECRET` to invalidate all sessions
5. Notify affected users if wallet addresses were exposed (public data, low risk)

### If Redis is compromised

1. Rotate `REDIS_URL` credentials
2. Flush the Redis instance: all nonces and rate limit counters reset
3. Rotate `JWT_SECRET` (refresh tokens reference Redis blacklist)
4. Redeploy

### If an OAuth client secret is leaked

1. Revoke the secret on the provider dashboard (GitHub/Google/Twitter)
2. Generate a new secret and update in Render env vars
3. Redeploy -- no user sessions are affected (OAuth is only for initial linking)

---

## Credential Rotation Procedure

### Routine Rotation (quarterly recommended)

| Credential | Where to Rotate | Impact |
|-----------|----------------|--------|
| `JWT_SECRET` | Render env vars | All users must re-login |
| `DATABASE_URL` | Render Postgres dashboard + env vars | Brief downtime during rotation |
| `REDIS_URL` | Render/Upstash dashboard + env vars | Nonces and rate limits reset |
| `PINATA_API_KEY` | Pinata dashboard + env vars | No user impact |
| `LIVEKIT_API_SECRET` | LiveKit dashboard + env vars | Active streams interrupted |
| `GEMINI_API_KEY` | Google AI Studio + env vars | AI moderation paused until redeployed |

### Steps

1. Generate new credential on the provider's dashboard
2. Update the env var in Render dashboard (do NOT commit to git)
3. Trigger a manual deploy in Render
4. Verify the health endpoint: `GET /api/v1/health`
5. Verify security endpoint: `GET /api/v1/health/security`
6. Revoke the old credential on the provider's dashboard

---

## Security Checklist (pre-deploy)

- [ ] `NODE_ENV=production` is set
- [ ] `JWT_SECRET` is at least 32 characters, randomly generated
- [ ] `CORS_ORIGINS` contains only the production frontend URL
- [ ] `DB_SSL_REJECT_UNAUTHORIZED=true` (unless provider requires `false`)
- [ ] `REDIS_SSL_REJECT_UNAUTHORIZED=true` (unless provider requires `false`)
- [ ] No secrets committed to git (check `.env` is in `.gitignore`)
- [ ] Swagger UI disabled in production (`NODE_ENV !== 'development'`)
- [ ] Rate limiting is active (check `GET /api/v1/health`)
- [ ] Backup cron is running (check `GET /api/v1/health/backup`)
