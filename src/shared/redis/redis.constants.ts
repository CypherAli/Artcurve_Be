// Injection tokens — dùng để @Inject() đúng client trong service
export const REDIS_CLIENT     = 'REDIS_CLIENT';      // regular commands
export const REDIS_SUBSCRIBER = 'REDIS_SUBSCRIBER';  // pub/sub only

// Key prefixes — centralize để tránh typo
export const REDIS_KEYS = {
  // Auth
  nonce:        (wallet: string)  => `nonce:${wallet.toLowerCase()}`,
  jwtBlacklist: (jti: string)     => `jwt:bl:${jti}`,

  // Rate limiting
  rateLimit:    (userId: string, action: string) => `rl:${userId}:${action}`,

  // Artwork price cache
  artworkPrice: (id: string)      => `artwork:${id}:price`,

  // Response cache (read-through)
  cacheArtwork: (id: string)              => `cache:artwork:${id}`,
  cacheVersion: (ns: string)              => `cache:ver:${ns}`,
  cacheList:    (ns: string, ver: string, key: string) => `cache:${ns}:v${ver}:${key}`,

  // Leaderboard
  trending24h:  ()                => `trending:24h`,
  trendingWeek: ()                => `trending:7d`,

  // Pub/Sub channels
  CHANNEL_PRICE_UPDATED: 'artwork:price:updated',
  CHANNEL_ARTWORK_GRADUATED: 'artwork:graduated',
} as const;

// TTLs (giây)
export const TTL = {
  NONCE:        5 * 60,      // 5 phút
  JWT_BLACKLIST: 7 * 24 * 3600, // 7 ngay (bang JWT_EXPIRES_IN)
  PRICE_CACHE:  30,          // 30 giay (refresh khi co trade)
  RATE_WINDOW:  60,          // 1 phut sliding window
  CACHE_DETAIL: 60,          // chi tiet artwork — invalidate khi trade/status change
  CACHE_LIST:   30,          // marketplace listing — versioned + TTL ngan
} as const;
