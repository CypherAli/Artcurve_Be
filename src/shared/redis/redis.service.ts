import { Injectable, Inject, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT, REDIS_SUBSCRIBER, REDIS_KEYS, TTL } from './redis.constants';

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
}

// ── RedisService ──────────────────────────────────────────────────────────────

@Injectable()
export class RedisService {
  private readonly logger = new Logger(RedisService.name);

  // ── In-memory fallback when Redis is unavailable ──────────────────────────
  // Nonce: wallet → { nonce, expiresAt }
  private readonly nonceStore = new Map<string, { nonce: string; expiresAt: number }>()
  // JWT blacklist: jti → expiresAt (unix ms)
  private readonly jwtBlacklist = new Map<string, number>()
  // Is Redis actually reachable?
  private redisReady = false

  constructor(
    @Inject(REDIS_CLIENT)     private readonly redis: Redis,
    @Inject(REDIS_SUBSCRIBER) private readonly sub: Redis,
  ) {
    // Track Redis readiness so we can fall back to in-memory gracefully
    this.redis.on('ready',        () => { this.redisReady = true })
    this.redis.on('error',        () => { this.redisReady = false })
    this.redis.on('close',        () => { this.redisReady = false })
    this.redis.on('reconnecting', () => { this.redisReady = false })
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

    // Lua dung pipeline de atomic: INCR + EXPIRE trong 1 round-trip
    const pipeline = this.redis.pipeline();
    pipeline.incr(key);
    pipeline.expire(key, windowSeconds);
    const results = await pipeline.exec();

    const current = (results?.[0]?.[1] as number) ?? 0;

    // Neu day la request dau tien (current == 1), EXPIRE vua duoc set
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
  // LEADERBOARD — ZADD/ZREVRANGE
  // ════════════════════════════════════════════════════════════════════════════

  /** [CONSUMER ONLY] Tang volume cho artwork sau moi trade */
  async incrementLeaderboard(artworkId: string, ethAmount: string): Promise<void> {
    const delta = parseFloat(ethAmount) || 0;
    if (delta <= 0) return;

    await this.redis.pipeline()
      .zincrby(REDIS_KEYS.trending24h(), delta, artworkId)
      .zincrby(REDIS_KEYS.trendingWeek(), delta, artworkId)
      .exec();
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
