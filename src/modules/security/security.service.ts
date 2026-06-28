import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SecurityEvent } from './entities/security-event.entity';
import { RedisService } from '../../shared/redis/redis.service';

@Injectable()
export class SecurityService {
  constructor(
    @InjectRepository(SecurityEvent)
    private readonly repo: Repository<SecurityEvent>,
    private readonly redisService: RedisService,
  ) {}

  /** Fire-and-forget — don't block the request */
  async log(event: Partial<SecurityEvent>): Promise<void> {
    this.repo.save(this.repo.create(event)).catch(() => {});
  }

  /** Track failed login attempts per IP — returns count */
  async trackFailedLogin(ip: string): Promise<number> {
    const key = `security:failed_login:${ip}`;
    const count = await this.redisService.increment(key);
    if (count === 1) await this.redisService.expire(key, 900); // 15 min window
    return count;
  }

  /** Check if IP is blocked */
  async isBlocked(ip: string): Promise<boolean> {
    const blocked = await this.redisService.getTemp(`blocked:${ip}`);
    return blocked === '1';
  }

  /** Block an IP for duration (seconds) */
  async blockIp(ip: string, durationSec = 1800): Promise<void> {
    await this.redisService.setTemp(`blocked:${ip}`, '1', durationSec);
  }

  /** Clear failed attempts (on successful login) */
  async clearFailedAttempts(ip: string): Promise<void> {
    await this.redisService.del(`security:failed_login:${ip}`);
  }

  /** Get recent security events (for admin dashboard later) */
  async getRecentEvents(limit = 50): Promise<SecurityEvent[]> {
    return this.repo.find({ order: { created_at: 'DESC' }, take: limit });
  }
}
