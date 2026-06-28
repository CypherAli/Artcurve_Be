import { Module, Global, Logger, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { REDIS_CLIENT, REDIS_SUBSCRIBER } from './redis.constants';
import { RedisService } from './redis.service';

function makeRedisClient(config: ConfigService, name: string): Redis {
  const url = config.get<string>('REDIS_URL');
  const client = url
    // REDIS_URL present (e.g. Upstash rediss://) — ioredis parses URL + TLS automatically
    ? new Redis(url, {
        maxRetriesPerRequest: null,
        enableReadyCheck:   false,
        enableOfflineQueue: true,
        lazyConnect:        true,
        retryStrategy:      (times) => Math.min(times * 1000, 15_000),
        tls: url.startsWith('rediss://') ? { rejectUnauthorized: config.get('REDIS_SSL_REJECT_UNAUTHORIZED', 'true') === 'true' } : undefined,
      })
    // Fallback: separate host/port/password (local dev)
    : new Redis({
        host:               config.get('REDIS_HOST', 'localhost'),
        port:               config.get<number>('REDIS_PORT', 6379),
        password:           config.get('REDIS_PASSWORD') || undefined,
        db:                 0,
        maxRetriesPerRequest: null,
        enableReadyCheck:   false,
        enableOfflineQueue: true,
        lazyConnect:        true,
        retryStrategy:      (times) => Math.min(times * 1000, 15_000),
      })

  // MUST attach error handler — otherwise Node throws on ECONNREFUSED
  const logger = new Logger(`Redis:${name}`)
  client.on('error',        (e) => logger.warn(`error: ${e.message}`))
  client.on('connect',      ()  => logger.log('connected'))
  client.on('reconnecting', ()  => logger.warn('reconnecting…'))

  return client
}

@Global()
@Module({
  providers: [
    {
      provide:    REDIS_CLIENT,
      inject:     [ConfigService],
      useFactory: (config: ConfigService): Redis => makeRedisClient(config, 'main'),
    },
    {
      provide:    REDIS_SUBSCRIBER,
      inject:     [ConfigService],
      useFactory: (config: ConfigService): Redis => makeRedisClient(config, 'sub'),
    },
    RedisService,
  ],
  exports: [RedisService, REDIS_CLIENT, REDIS_SUBSCRIBER],
})
export class RedisModule implements OnApplicationShutdown {
  async onApplicationShutdown() { /* ioredis cleans up on process exit */ }
}
