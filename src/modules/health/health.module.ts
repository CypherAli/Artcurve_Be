import { Module }                  from '@nestjs/common'
import { TerminusModule }          from '@nestjs/terminus'
import { HttpModule }              from '@nestjs/axios'
import { HealthController }        from './health.controller'
// RedisModule và ClickHouseModule được đánh dấu @Global nên inject trực tiếp

@Module({
  imports:     [TerminusModule, HttpModule],
  controllers: [HealthController],
})
export class HealthModule {}
