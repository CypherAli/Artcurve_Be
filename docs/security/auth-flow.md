# Authentication Flows

## SIWE (Sign-In With Ethereum)

Primary auth method — wallet-based, phishing-resistant.

```
┌──────────┐                    ┌──────────┐                    ┌───────┐
│  Browser  │                    │  NestJS   │                    │ Redis │
└─────┬────┘                    └─────┬────┘                    └───┬───┘
      │                               │                             │
      │  POST /auth/nonce              │                             │
      │  { wallet_address }            │                             │
      │──────────────────────────────▶│                             │
      │                               │  SET nonce:{wallet} TTL=5m  │
      │                               │────────────────────────────▶│
      │                               │                             │
      │  { nonce, message }            │                             │
      │◀──────────────────────────────│                             │
      │                               │                             │
      │  User signs SIWE message       │                             │
      │  in wallet (MetaMask etc.)     │                             │
      │                               │                             │
      │  POST /auth/verify             │                             │
      │  { wallet, signature, message }│                             │
      │──────────────────────────────▶│                             │
      │                               │  GETDEL nonce:{wallet}      │
      │                               │────────────────────────────▶│
      │                               │  (atomic consume — replay   │
      │                               │   protection)               │
      │                               │                             │
      │                               │  Verify:                    │
      │                               │  1. Nonce exists?            │
      │                               │  2. Signature valid?         │
      │                               │  3. Domain matches?          │
      │                               │  4. Address checksum?        │
      │                               │                             │
      │                               │  Find/create user in DB     │
      │                               │                             │
      │  { access_token, refresh_token,│                             │
      │    expires_in, user }          │                             │
      │◀──────────────────────────────│                             │
```

### Token Lifecycle

- **Access Token**: JWT, 15 minutes, contains `{ sub, wallet, role, jti }`
- **Refresh Token**: Random 64 bytes, 30 days, SHA-256 hashed in Redis
- **Rotation**: On refresh, old token deleted, new pair issued
- **Logout**: JTI added to Redis blacklist (TTL = token remaining lifetime)

## OAuth (GitHub / Google / Twitter / Telegram)

```
1. FE redirects to: GET /auth/{provider}
2. BE generates CSRF state (32 random bytes), stores in Redis (10min TTL)
3. BE redirects to provider OAuth page
4. User authorizes → provider redirects to callback URL
5. BE callback:
   a. Validate CSRF state (atomic GETDEL from Redis)
   b. Exchange code for access token
   c. Fetch user profile from provider
   d. Link to existing user (by wallet) or create new
   e. Issue JWT pair
   f. Redirect to FE with auth code
6. FE exchanges code for tokens via POST /auth/exchange
```

### Supported Providers

| Provider | Callback URL | Notes |
|----------|-------------|-------|
| Google | `/auth/google/callback` | Email + avatar |
| GitHub | `/auth/github/callback` | Username + avatar |
| Twitter | `/auth/twitter/callback` | OAuth 2.0 PKCE |
| Telegram | `/auth/telegram/callback` | HMAC-SHA256 verification |
