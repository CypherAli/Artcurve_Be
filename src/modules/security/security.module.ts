import { Module, Global } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SecurityEvent } from './entities/security-event.entity';
import { SecurityService } from './security.service';
import { BackupService } from './backup.service';
import { SecurityController } from './security.controller';

@Global()
@Module({
  imports:     [TypeOrmModule.forFeature([SecurityEvent])],
  controllers: [SecurityController],
  providers:   [SecurityService, BackupService],
  exports:     [SecurityService, BackupService],
})
export class SecurityModule {}
