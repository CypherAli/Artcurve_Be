import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RedisService } from './redis.service';

// ── Decorator @RateLimit(limit, windowSeconds) ────────────────────────────────
// Dung tren controller method: @RateLimit(10, 60) = max 10 req/phut per user

export const RATE_LIMIT_KEY = 'rateLimit';

export interface RateLimitOptions {
  limit: number;
  windowSeconds: number;
  action?: string;  // ten hanh dong, default lay ten method
}

export const RateLimit = (limit: number, windowSeconds = 60, action?: string) =>
  SetMetadata(RATE_LIMIT_KEY, { limit, windowSeconds, action } as RateLimitOptions);

// ── RateLimitGuard ────────────────────────────────────────────────────────────

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector:    Reflector,
    private readonly redisService: RedisService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.getAllAndOverride<RateLimitOptions | undefined>(
      RATE_LIMIT_KEY,
      [context.getHandler(), context.getClass()],
    );

    // Khong co @RateLimit() -> pass
    if (!options) return true;

    const request = context.switchToHttp().getRequest();
    const user    = request['user'];

    // Dung userId neu da auth, fallback sang IP neu la public endpoint
    const identifier = user?.sub ?? request.ip ?? 'anonymous';
    const action     = options.action ?? context.getHandler().name;

    const { allowed, current, limit } = await this.redisService.checkRateLimit(
      identifier,
      action,
      options.limit,
      options.windowSeconds,
    );

    // Gan header de frontend biet con bao nhieu request
    const response = context.switchToHttp().getResponse();
    response.setHeader('X-RateLimit-Limit',     limit);
    response.setHeader('X-RateLimit-Remaining', Math.max(0, limit - current));
    response.setHeader('X-RateLimit-Window',    options.windowSeconds);

    if (!allowed) {
      throw new HttpException(
        `Rate limit vuot qua: ${current}/${limit} requests trong ${options.windowSeconds}s. Thu lai sau.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }
}
