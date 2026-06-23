import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule }     from '@nestjs/typeorm';
import { LiveStream }        from './entities/live-stream.entity';
import { LiveChat }          from './entities/live-chat.entity';
import { LiveTip }           from './entities/live-tip.entity';
import { LiveService }       from './live.service';
import { LiveController }    from './live.controller';
import { RedisModule }       from '../../shared/redis/redis.module';
import { GatewayModule }     from '../gateway/gateway.module';

@Module({
  imports:     [
    TypeOrmModule.forFeature([LiveStream, LiveChat, LiveTip]),
    RedisModule,
    forwardRef(() => GatewayModule),
  ],
  controllers: [LiveController],
  providers:   [LiveService],
  exports:     [LiveService],
})
export class LiveModule {}
