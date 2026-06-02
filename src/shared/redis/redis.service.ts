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
  artwork_id: string;
  current_price: string;
  current_supply: string;
  volume_24h: string;
  tx_hash: string;
  timestamp: number;
}

// ── RedisService ──────────────────────────────────────────────────────────────

@Injectable()
export class RedisService {
  private readonly logger = new Logger(RedisService.name);

  constructor(
    @Inject(REDIS_CLIENT)     private readonly redis: Redis,
    @Inject(REDIS_SUBSCRIBER) private readonly sub: Redis,
  ) {}

  // ════════════════════════════════════════════════════════════════════════════
  // AUTH — Nonce (thay the PostgreSQL query, nhanh hon 100x)
  // ════════════════════════════════════════════════════════════════════════════

  /** Luu nonce voi TTL 5 phut */
  async setNonce(wallet: string, nonce: string): Promise<void> {
    await this.redis.setex(REDIS_KEYS.nonce(wallet), TTL.NONCE, nonce);
  }

  /** Doc nonce (tra ve null neu het han hoac khong ton tai) */
  async getNonce(wallet: string): Promise<string | null> {
    return this.redis.get(REDIS_KEYS.nonce(wallet));
  }

  /**
   * GETDEL — atomic: lay nonce roi xoa ngay
   * Chong replay attack: sau khi verify, nonce bien mat khoi Redis luc tuc
   */
  async consumeNonce(wallet: string): Promise<string | null> {
    // GETDEL la atomic command cua Redis 6.2+
    // Fallback manual GET+DEL cho Redis cu hon
    const nonce = await this.redis.getdel(REDIS_KEYS.nonce(wallet));
    return nonce;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // AUTH — JWT Blacklist (logout that su)
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Ghi JWT vao blacklist khi user logout
   * TTL = thoi gian con lai cua token (khong waste memory cho token het han)
   */
  async blacklistJwt(jti: string, remainingTtlSeconds: number): Promise<void> {
    if (remainingTtlSeconds <= 0) return; // Token da het han, khong can blacklist
    await this.redis.setex(REDIS_KEYS.jwtBlacklist(jti), remainingTtlSeconds, '1');
  }

  /** Kiem tra JWT co bi blacklist khong — goi trong JwtAuthGuard */
  async isJwtBlacklisted(jti: string): Promise<boolean> {
    const exists = await this.redis.exists(REDIS_KEYS.jwtBlacklist(jti));
    return exists === 1;
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

  /**
   * [CONSUMER ONLY] Phat tin hieu gia thay doi
   * WebSocket Gateway lang nghe channel nay va day xuong frontend
   */
  async publishPriceUpdate(event: PriceUpdatedEvent): Promise<void> {
    await this.redis.publish(
      REDIS_KEYS.CHANNEL_PRICE_UPDATED,
      JSON.stringify(event),
    );
    this.logger.debug(
      `Published price update: artwork=${event.artwork_id} price=${event.current_price}`,
    );
  }

  /** [GATEWAY ONLY] Subscribe vao channel gia */
  async subscribePriceUpdates(
    callback: (event: PriceUpdatedEvent) => void,
  ): Promise<void> {
    await this.sub.subscribe(REDIS_KEYS.CHANNEL_PRICE_UPDATED);

    this.sub.on('message', (channel: string, message: string) => {
      if (channel !== REDIS_KEYS.CHANNEL_PRICE_UPDATED) return;
      try {
        const event: PriceUpdatedEvent = JSON.parse(message);
        callback(event);
      } catch (e) {
        this.logger.error('Failed to parse price update message', e);
      }
    });
  }

  async publishArtworkGraduated(artworkId: string): Promise<void> {
    await this.redis.publish(
      REDIS_KEYS.CHANNEL_ARTWORK_GRADUATED,
      JSON.stringify({ artwork_id: artworkId, timestamp: Date.now() }),
    );
  }

  // ════════════════════════════════════════════════════════════════════════════
  // UTILITIES
  // ════════════════════════════════════════════════════════════════════════════

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
}
