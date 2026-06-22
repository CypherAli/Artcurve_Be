import { Injectable, Inject, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT, REDIS_SUBSCRIBER, REDIS_KEYS, TTL } from './redis.constants';

// Cửa sổ thời gian cho leaderboard (giây) — key tự hết hạn rồi rebuild → tránh
// "trending 24h/7d" tích luỹ vô hạn (label sai + memory leak).
const LEADERBOARD_TTL = { '24h': 24 * 3600, '7d': 7 * 24 * 3600 } as const;

// ── Interfaces ────────────────────────────────────────────────────────────────

export interface ArtworkPriceCache {
  current_price: string;
  current_supply: string;
  volume_24h: string;
  updated_at: string;
}

export interface PriceUpdatedEvent {
  artwork_id:     string;
  current_price:  string;
  current_supply: string;
  volume_24h:     string;
  tx_hash:        string;
  timestamp:      number;
  // Trade metadata — dùng bởi EventsGateway để broadcast trade_updated
  is_buy?:      boolean;
  user_wallet?: string;
  share_amount?: string;
  eth_amount?:  string;   // ETH của riêng giao dịch này (KHÁC volume_24h tích luỹ)
}

// ── RedisService ──────────────────────────────────────────────────────────────

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);

  // ── In-memory fallback when Redis is unavailable ──────────────────────────
  // Nonce: wallet → { nonce, expiresAt }
  private readonly nonceStore = new Map<string, { nonce: string; expiresAt: number }>()
  // JWT blacklist: jti → expiresAt (unix ms)
  private readonly jwtBlacklist = new Map<string, number>()
  // Is Redis actually reachable?
  private redisReady = false
  // Periodic prune cho in-memory fallback (chống unbounded growth ở dev mode)
  private pruneTimer?: NodeJS.Timeout

  constructor(
    @Inject(REDIS_CLIENT)     private readonly redis: Redis,
    @Inject(REDIS_SUBSCRIBER) private readonly sub: Redis,
  ) {
    // Track Redis readiness so we can fall back to in-memory gracefully
    this.redis.on('ready',        () => { this.redisReady = true })
    this.redis.on('error',        () => { this.redisReady = false })
    this.redis.on('close',        () => { this.redisReady = false })
    this.redis.on('reconnecting', () => { this.redisReady = false })

    // Dọn entry hết hạn mỗi 60s khi đang dùng in-memory fallback.
    // unref() để timer không giữ process sống khi shutdown.
    this.pruneTimer = setInterval(() => this.pruneExpired(), 60_000)
    this.pruneTimer.unref?.()
  }

  /** Cleanup khi app shutdown — hủy listener pub/sub + timer (tránh leak). */
  async onModuleDestroy(): Promise<void> {
    if (this.pruneTimer) clearInterval(this.pruneTimer)
    this.priceCallbacks.clear()
    this.graduatedCallbacks.clear()
    try {
      await this.sub.unsubscribe(
        REDIS_KEYS.CHANNEL_PRICE_UPDATED,
        REDIS_KEYS.CHANNEL_ARTWORK_GRADUATED,
      )
    } catch {
      /* ignore — đang shutdown */
    }
  }

  /** Xoá entry hết hạn khỏi các Map fallback in-memory. */
  private pruneExpired(): void {
    const now = Date.now()
    for (const [k, v] of this.nonceStore)  if (now > v.expiresAt) this.nonceStore.delete(k)
    for (const [k, exp] of this.jwtBlacklist) if (now > exp)      this.jwtBlacklist.delete(k)
    for (const [k, v] of this.tempStore)   if (now > v.expiresAt) this.tempStore.delete(k)
  }

  // ════════════════════════════════════════════════════════════════════════════
  // AUTH — Nonce (thay the PostgreSQL query, nhanh hon 100x)
  // ════════════════════════════════════════════════════════════════════════════

  /** Luu nonce voi TTL 5 phut */
  async setNonce(wallet: string, nonce: string): Promise<void> {
    if (this.redisReady) {
      await this.redis.setex(REDIS_KEYS.nonce(wallet), TTL.NONCE, nonce)
    } else {
      // In-memory fallback
      this.nonceStore.set(wallet, { nonce, expiresAt: Date.now() + TTL.NONCE * 1000 })
      this.logger.warn('[Auth] Redis unavailable — nonce stored in-memory (dev only)')
    }
  }

  /** Doc nonce (tra ve null neu het han hoac khong ton tai) */
  async getNonce(wallet: string): Promise<string | null> {
    if (this.redisReady) {
      return this.redis.get(REDIS_KEYS.nonce(wallet))
    }
    // In-memory fallback
    const entry = this.nonceStore.get(wallet)
    if (!entry) return null
    if (Date.now() > entry.expiresAt) { this.nonceStore.delete(wallet); return null }
    return entry.nonce
  }

  /**
   * GETDEL — atomic: lay nonce roi xoa ngay
   * Chong replay attack: sau khi verify, nonce bien mat khoi Redis luc tuc
   */
  async consumeNonce(wallet: string): Promise<string | null> {
    if (this.redisReady) {
      return this.redis.getdel(REDIS_KEYS.nonce(wallet))
    }
    // In-memory fallback
    const entry = this.nonceStore.get(wallet)
    if (!entry) return null
    this.nonceStore.delete(wallet)
    if (Date.now() > entry.expiresAt) return null
    return entry.nonce
  }

  // ════════════════════════════════════════════════════════════════════════════
  // GENERIC TEMP STORE — dùng cho OAuth token_secret (TTL ngắn)
  // ════════════════════════════════════════════════════════════════════════════
  private readonly tempStore = new Map<string, { value: string; expiresAt: number }>()

  async setTemp(key: string, value: string, ttlSeconds = 300): Promise<void> {
    if (this.redisReady) {
      await this.redis.setex(`temp:${key}`, ttlSeconds, value)
    } else {
      this.tempStore.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 })
    }
  }

  async getTemp(key: string): Promise<string | null> {
    if (this.redisReady) {
      return this.redis.get(`temp:${key}`)
    }
    const entry = this.tempStore.get(key)
    if (!entry) return null
    if (Date.now() > entry.expiresAt) { this.tempStore.delete(key); return null }
    return entry.value
  }

  async deleteTemp(key: string): Promise<void> {
    if (this.redisReady) await this.redis.del(`temp:${key}`)
    else this.tempStore.delete(key)
  }

  /** GETDEL — atomic: lấy temp value rồi xóa ngay (chống race condition) */
  async consumeTemp(key: string): Promise<string | null> {
    if (this.redisReady) {
      return this.redis.getdel(`temp:${key}`)
    }
    // In-memory fallback
    const entry = this.tempStore.get(key)
    if (!entry) return null
    this.tempStore.delete(key)
    if (Date.now() > entry.expiresAt) return null
    return entry.value
  }

  // ════════════════════════════════════════════════════════════════════════════
  // AUTH — JWT Blacklist (logout that su)
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Ghi JWT vao blacklist khi user logout
   * TTL = thoi gian con lai cua token (khong waste memory cho token het han)
   */
  async blacklistJwt(jti: string, remainingTtlSeconds: number): Promise<void> {
    if (remainingTtlSeconds <= 0) return
    if (this.redisReady) {
      await this.redis.setex(REDIS_KEYS.jwtBlacklist(jti), remainingTtlSeconds, '1')
    } else {
      this.jwtBlacklist.set(jti, Date.now() + remainingTtlSeconds * 1000)
    }
  }

  /** Kiem tra JWT co bi blacklist khong — goi trong JwtAuthGuard */
  async isJwtBlacklisted(jti: string): Promise<boolean> {
    if (this.redisReady) {
      const exists = await this.redis.exists(REDIS_KEYS.jwtBlacklist(jti))
      return exists === 1
    }
    // In-memory fallback
    const exp = this.jwtBlacklist.get(jti)
    if (!exp) return false
    if (Date.now() > exp) { this.jwtBlacklist.delete(jti); return false }
    return true
  }

  // ════════════════════════════════════════════════════════════════════════════
  // RATE LIMITING — sliding window counter
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Kiem tra rate limit
   * @returns true = con phep, false = bi chan
   */
  async checkRateLimit(
    userId: string,
    action: string,
    limit: number,
    windowSeconds: number = TTL.RATE_WINDOW,
  ): Promise<{ allowed: boolean; current: number; limit: number }> {
    const key = REDIS_KEYS.rateLimit(userId, action);

    // Atomic Lua: INCR + set EXPIRE CHỈ khi key vừa được tạo (count==1).
    // Tránh race của pipeline (INCR ok nhưng EXPIRE fail → key sống mãi → bucket
    // không bao giờ reset → user bị chặn vĩnh viễn).
    const script = `
      local c = redis.call('INCR', KEYS[1])
      if c == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
      return c
    `;
    const current = (await this.redis.eval(script, 1, key, String(windowSeconds))) as number;

    return {
      allowed: current <= limit,
      current,
      limit,
    };
  }

  // ════════════════════════════════════════════════════════════════════════════
  // PRICE CACHE — RabbitMQ Consumer ghi, API doc
  // RULE: Chi RabbitMQ Consumer moi duoc goi setArtworkPrice()
  // ════════════════════════════════════════════════════════════════════════════

  /** [CONSUMER ONLY] Cap nhat gia sau moi trade */
  async setArtworkPrice(
    artworkId: string,
    data: ArtworkPriceCache,
  ): Promise<void> {
    await this.redis.hset(REDIS_KEYS.artworkPrice(artworkId), {
      current_price:  data.current_price,
      current_supply: data.current_supply,
      volume_24h:     data.volume_24h,
      updated_at:     data.updated_at,
    });
    // Khong set TTL — gia ton tai mai, chi bi ghi de boi trade moi
  }

  /** Doc gia tu cache (API dung cai nay) */
  async getArtworkPrice(artworkId: string): Promise<ArtworkPriceCache | null> {
    const data = await this.redis.hgetall(REDIS_KEYS.artworkPrice(artworkId));
    if (!data || !data.current_price) return null;
    return data as unknown as ArtworkPriceCache;
  }

  /** Doc gia nhieu artwork cung luc — dung cho marketplace listing */
  async getMultipleArtworkPrices(
    artworkIds: string[],
  ): Promise<Record<string, ArtworkPriceCache | null>> {
    if (artworkIds.length === 0) return {};

    const pipeline = this.redis.pipeline();
    for (const id of artworkIds) {
      pipeline.hgetall(REDIS_KEYS.artworkPrice(id));
    }
    const results = await pipeline.exec();

    const out: Record<string, ArtworkPriceCache | null> = {};
    artworkIds.forEach((id, i) => {
      const data = results?.[i]?.[1] as Record<string, string> | null;
      out[id] = data?.current_price ? (data as unknown as ArtworkPriceCache) : null;
    });
    return out;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // RESPONSE CACHE — read-through JSON cache cho hot paths (marketplace, detail)
  // Fail-open: nếu Redis down → trả null (miss) / no-op, KHÔNG ném lỗi.
  // ════════════════════════════════════════════════════════════════════════════

  /** Đọc JSON đã cache. Trả null nếu miss hoặc Redis không sẵn sàng. */
  async cacheGetJson<T>(key: string): Promise<T | null> {
    if (!this.redisReady) return null;
    try {
      const raw = await this.redis.get(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  }

  /** Ghi JSON vào cache với TTL (giây). No-op nếu Redis không sẵn sàng. */
  async cacheSetJson(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    if (!this.redisReady) return;
    try {
      await this.redis.setex(key, ttlSeconds, JSON.stringify(value));
    } catch {
      /* fail-open: cache write không được phép làm hỏng request */
    }
  }

  /** Xoá 1 key cache (invalidation tức thì cho artwork detail). */
  async cacheDel(key: string): Promise<void> {
    if (!this.redisReady) return;
    try {
      await this.redis.del(key);
    } catch {
      /* ignore */
    }
  }

  /**
   * Lấy version hiện tại của một namespace cache (vd: 'marketplace').
   * Version nhúng vào cache key → bump version = vô hiệu hoá toàn bộ list cũ
   * tức thì mà KHÔNG cần SCAN/DEL pattern (tránh O(N) trên Redis).
   */
  async cacheGetVersion(ns: string): Promise<string> {
    if (!this.redisReady) return '0';
    try {
      return (await this.redis.get(REDIS_KEYS.cacheVersion(ns))) ?? '0';
    } catch {
      return '0';
    }
  }

  /** Tăng version → mọi list cache cũ của namespace trở thành orphan (tự hết hạn theo TTL). */
  async cacheBumpVersion(ns: string): Promise<void> {
    if (!this.redisReady) return;
    try {
      await this.redis.incr(REDIS_KEYS.cacheVersion(ns));
    } catch {
      /* ignore */
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // LEADERBOARD — ZADD/ZREVRANGE
  // ════════════════════════════════════════════════════════════════════════════

  /** [CONSUMER ONLY] Tang volume cho artwork sau moi trade */
  async incrementLeaderboard(artworkId: string, ethAmount: string): Promise<void> {
    const delta = parseFloat(ethAmount) || 0;
    if (delta <= 0) return;

    // ZINCRBY + set EXPIRE chỉ khi key mới tạo → set tự hết hạn sau cửa sổ rồi
    // rebuild. "trending 24h/7d" do đó là rolling window thực sự thay vì tích luỹ
    // vô hạn. Atomic qua Lua để TTL không bị bỏ sót.
    const script = `
      redis.call('ZINCRBY', KEYS[1], ARGV[1], ARGV[3])
      if redis.call('TTL', KEYS[1]) < 0 then redis.call('EXPIRE', KEYS[1], ARGV[4]) end
      redis.call('ZINCRBY', KEYS[2], ARGV[2], ARGV[3])
      if redis.call('TTL', KEYS[2]) < 0 then redis.call('EXPIRE', KEYS[2], ARGV[5]) end
    `;
    await this.redis.eval(
      script, 2,
      REDIS_KEYS.trending24h(), REDIS_KEYS.trendingWeek(),
      String(delta), String(delta), artworkId,
      String(LEADERBOARD_TTL['24h']), String(LEADERBOARD_TTL['7d']),
    );
  }

  /** Lay top N artwork theo volume (cho sort=trending) */
  async getLeaderboard(
    type: '24h' | '7d' = '24h',
    limit = 20,
  ): Promise<Array<{ artworkId: string; volume: string }>> {
    const key = type === '24h' ? REDIS_KEYS.trending24h() : REDIS_KEYS.trendingWeek();
    const raw = await this.redis.zrevrange(key, 0, limit - 1, 'WITHSCORES');

    // WITHSCORES tra ve [id, score, id, score, ...]
    const result: Array<{ artworkId: string; volume: string }> = [];
    for (let i = 0; i < raw.length; i += 2) {
      result.push({ artworkId: raw[i], volume: raw[i + 1] });
    }
    return result;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // PUB/SUB — CONSUMER publish, WebSocket Gateway subscribe
  // ════════════════════════════════════════════════════════════════════════════

  // Internal callback registries — nhiều gateway có thể đăng ký mà không bị
  // double-subscribe trên Redis subscriber client.
  private readonly priceCallbacks      = new Set<(event: PriceUpdatedEvent) => void>();
  private readonly graduatedCallbacks  = new Set<(artworkId: string) => void>();
  private channelListenerRegistered    = false;

  /** Đăng ký lắng nghe Redis message một lần duy nhất, route đến đúng callbacks. */
  private ensureChannelListener(): void {
    if (this.channelListenerRegistered) return;
    this.channelListenerRegistered = true;

    this.sub.on('message', (channel: string, message: string) => {
      try {
        if (channel === REDIS_KEYS.CHANNEL_PRICE_UPDATED) {
          const event: PriceUpdatedEvent = JSON.parse(message);
          this.priceCallbacks.forEach(cb => cb(event));
        } else if (channel === REDIS_KEYS.CHANNEL_ARTWORK_GRADUATED) {
          const { artwork_id } = JSON.parse(message) as { artwork_id: string };
          this.graduatedCallbacks.forEach(cb => cb(artwork_id));
        }
      } catch (e) {
        this.logger.error('Failed to parse Redis pub/sub message', e);
      }
    });
  }

  /** [CONSUMER ONLY] Phát tín hiệu giá thay đổi sau mỗi trade */
  async publishPriceUpdate(event: PriceUpdatedEvent): Promise<void> {
    await this.redis.publish(
      REDIS_KEYS.CHANNEL_PRICE_UPDATED,
      JSON.stringify(event),
    );
    this.logger.debug(
      `Published price update: artwork=${event.artwork_id} price=${event.current_price}`,
    );
  }

  /**
   * [GATEWAY ONLY] Subscribe vào channel giá.
   * An toàn khi gọi nhiều lần: Redis sub.subscribe() idempotent,
   * callback được thêm vào Set — không tạo duplicate listener.
   */
  async subscribePriceUpdates(
    callback: (event: PriceUpdatedEvent) => void,
  ): Promise<void> {
    this.ensureChannelListener();
    this.priceCallbacks.add(callback);
    await this.sub.subscribe(REDIS_KEYS.CHANNEL_PRICE_UPDATED);
  }

  /** [CONSUMER ONLY] Phát tín hiệu artwork đã graduate lên DEX */
  async publishArtworkGraduated(artworkId: string): Promise<void> {
    await this.redis.publish(
      REDIS_KEYS.CHANNEL_ARTWORK_GRADUATED,
      JSON.stringify({ artwork_id: artworkId, timestamp: Date.now() }),
    );
  }

  /**
   * [GATEWAY ONLY] Subscribe vào graduation channel.
   * callback nhận artwork_id khi artwork đạt target cap.
   */
  async subscribeArtworkGraduated(
    callback: (artworkId: string) => void,
  ): Promise<void> {
    this.ensureChannelListener();
    this.graduatedCallbacks.add(callback);
    await this.sub.subscribe(REDIS_KEYS.CHANNEL_ARTWORK_GRADUATED);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // UTILITIES
  // ════════════════════════════════════════════════════════════════════════════

  // ════════════════════════════════════════════════════════════════════════════
  // SET — track unique members (dùng cho live viewer dedup)
  // ════════════════════════════════════════════════════════════════════════════

  async sadd(key: string, member: string): Promise<number> {
    return this.redis.sadd(key, member)
  }

  async srem(key: string, member: string): Promise<number> {
    return this.redis.srem(key, member)
  }

  async scard(key: string): Promise<number> {
    return this.redis.scard(key)
  }

  async ping(): Promise<boolean> {
    try {
      const res = await this.redis.ping();
      return res === 'PONG';
    } catch {
      return false;
    }
  }

  /** Xoa key (dung trong test/seed) */
  async del(...keys: string[]): Promise<void> {
    if (keys.length > 0) await this.redis.del(...keys);
  }

  /** INCR — atomic increment, trả về giá trị sau khi tăng */
  async increment(key: string): Promise<number> {
    return this.redis.incr(key);
  }

  /** EXPIRE — set TTL (giây) cho key */
  async expire(key: string, seconds: number): Promise<void> {
    await this.redis.expire(key, seconds);
  }

  /** Scan keys matching pattern (dùng cho refresh token lookup) */
  async scanKeys(pattern: string, count = 100): Promise<string[]> {
    const results: string[] = [];
    let cursor = '0';
    do {
      const [next, keys] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', count);
      cursor = next;
      results.push(...keys);
      if (results.length > 0) break;
    } while (cursor !== '0');
    return results;
  }
}
