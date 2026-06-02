import { Module, Global, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { REDIS_CLIENT, REDIS_SUBSCRIBER } from './redis.constants';
import { RedisService } from './redis.service';

function makeRedisClient(config: ConfigService, name: string): Redis {
  const client = new Redis({
    host:               config.get('REDIS_HOST', 'localhost'),
    port:               config.get<number>('REDIS_PORT', 6379),
    password:           config.get('REDIS_PASSWORD') || undefined,
    db:                 0,
    maxRetriesPerRequest: null,   // never throw — queue forever
    enableReadyCheck:   false,    // don't block on READY
    enableOfflineQueue: true,     // queue cmds while disconnected
    lazyConnect:        true,     // don't connect until first command
    retryStrategy:      (times) => Math.min(times * 1000, 15_000),
  })

  // MUST attach error handler — otherwise Node throws on ECONNREFUSED
  client.on('error',        (e) => console.warn(`[Redis:${name}] error: ${e.message}`))
  client.on('connect',      ()  => console.log(`[Redis:${name}] connected`))
  client.on('reconnecting', ()  => console.warn(`[Redis:${name}] reconnecting…`))

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
