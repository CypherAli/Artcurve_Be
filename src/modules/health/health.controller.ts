import { Controller, Get, Post, Optional } from '@nestjs/common'
import { ApiTags, ApiOperation }          from '@nestjs/swagger'
import {
  HealthCheckService,
  TypeOrmHealthIndicator,
  HealthCheck,
  MemoryHealthIndicator,
  HealthIndicatorResult,
} from '@nestjs/terminus'
import { InjectDataSource }               from '@nestjs/typeorm'
import { DataSource }                     from 'typeorm'
import { Public }                         from '../../common/decorators'
import { RedisService }                   from '../../shared/redis/redis.service'
import { InfraClickHouseService }         from '../../shared/clickhouse/clickhouse-infra.service'
import { RabbitMQBlockchainConsumer }     from '../blockchain/consumers/rabbitmq.consumer'
import { SecurityService }               from '../security/security.service'
import { BackupService }                 from '../security/backup.service'

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    private health:      HealthCheckService,
    private db:          TypeOrmHealthIndicator,
    private memory:      MemoryHealthIndicator,
    @InjectDataSource() private dataSource: DataSource,
    private readonly redisService: RedisService,
    private readonly chService:    InfraClickHouseService,
    private readonly securityService: SecurityService,
    private readonly backupService:   BackupService,
    @Optional() private readonly rmqConsumer?: RabbitMQBlockchainConsumer,
  ) {}

  @Get()
  @Public()
  @HealthCheck()
  @ApiOperation({ summary: 'Full health check — PostgreSQL, Redis, ClickHouse, Memory' })
  check() {
    return this.health.check([
      // PostgreSQL
      () => this.db.pingCheck('postgresql', { connection: this.dataSource }),

      // Redis — bắt buộc cho nonce/blacklist/pub-sub
      async (): Promise<HealthIndicatorResult> => {
        const ok = await this.redisService.ping()
        return { redis: { status: ok ? 'up' : 'down' } }
      },

      // ClickHouse — bắt buộc cho OHLCV/analytics
      async (): Promise<HealthIndicatorResult> => {
        const ok = await this.chService.ping()
        return { clickhouse: { status: ok ? 'up' : 'down' } }
      },

      // RabbitMQ — blockchain event consumer
      async (): Promise<HealthIndicatorResult> => {
        const ok = this.rmqConsumer?.isHealthy() ?? false
        return { rabbitmq: { status: ok ? 'up' : 'down' } }
      },

      // Memory guards — ngăn OOM crash trên container nhỏ
      () => this.memory.checkHeap('memory_heap', 512 * 1024 * 1024),  // 512 MB
      () => this.memory.checkRSS('memory_rss',  1024 * 1024 * 1024), // 1 GB
    ])
  }

  @Get('ping')
  @Public()
  @ApiOperation({ summary: 'Liveness probe — trả 200 OK ngay, không check dependencies' })
  ping() {
    return { status: 'ok', timestamp: new Date().toISOString(), service: 'artcurve-api' }
  }

  @Get('security')
  @Public()
  @ApiOperation({ summary: 'Recent security events (last 10)' })
  async getSecurityStatus() {
    const recentEvents = await this.securityService.getRecentEvents(10);
    return {
      recentEvents: recentEvents.map(e => ({
        type:     e.event_type,
        severity: e.severity,
        ip:       e.ip_address,
        wallet:   e.wallet_address,
        time:     e.created_at,
      })),
    };
  }

  @Get('backup')
  @Public()
  @ApiOperation({ summary: 'Backup status — last run, size, next scheduled' })
  async getBackupStatus() {
    return this.backupService.getStatus();
  }

  @Post('backup/run')
  @ApiOperation({ summary: 'Trigger manual backup (requires auth)' })
  async runBackupNow() {
    return this.backupService.runBackup();
  }
}
