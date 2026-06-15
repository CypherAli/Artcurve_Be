import { Global, Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Notification } from './entities/notification.entity';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { GatewayModule } from '../gateway/gateway.module';

@Global()
@Module({
  imports:     [TypeOrmModule.forFeature([Notification]), forwardRef(() => GatewayModule)],
  providers:   [NotificationsService],
  controllers: [NotificationsController],
  exports:     [NotificationsService],
})
export class NotificationsModule {}
