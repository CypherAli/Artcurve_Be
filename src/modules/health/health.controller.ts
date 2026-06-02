import { Controller, Get }                                                          from '@nestjs/common'
import { ApiTags, ApiOperation }                                                       from '@nestjs/swagger'
import {
  HealthCheckService,
  TypeOrmHealthIndicator,
  HealthCheck,
  MemoryHealthIndicator,
} from '@nestjs/terminus'
import { InjectDataSource }                                                            from '@nestjs/typeorm'
import { DataSource }                                                                  from 'typeorm'
import { Public }                                                                      from '../../common/decorators'

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    private health:   HealthCheckService,
    private db:       TypeOrmHealthIndicator,
    private memory:   MemoryHealthIndicator,
    @InjectDataSource() private dataSource: DataSource,
  ) {}

  @Get()
  @Public()
  @HealthCheck()
  @ApiOperation({ summary: 'Service health check — used by load balancer / k8s probe' })
  check() {
    return this.health.check([
      () => this.db.pingCheck('postgresql', { connection: this.dataSource }),
      () => this.memory.checkHeap('memory_heap', 512 * 1024 * 1024),  // 512 MB
      () => this.memory.checkRSS('memory_rss',  1024 * 1024 * 1024), // 1 GB
    ])
  }

  @Get('ping')
  @Public()
  @ApiOperation({ summary: 'Simple liveness probe — returns 200 OK immediately' })
  ping() {
    return { status: 'ok', timestamp: new Date().toISOString(), service: 'artcurve-api' }
  }
}
