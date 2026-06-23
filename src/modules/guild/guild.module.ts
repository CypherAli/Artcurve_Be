import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Guild } from './entities/guild.entity';
import { GuildMember } from './entities/guild-member.entity';
import { GuildMessage } from './entities/guild-message.entity';
import { GuildAnnouncement } from './entities/guild-announcement.entity';
import { GuildInvite } from './entities/guild-invite.entity';
import { PortfolioHolding } from '../portfolio/entities/portfolio-holding.entity';
import { GuildService } from './guild.service';
import { GuildController } from './guild.controller';
import { GatewayModule } from '../gateway/gateway.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Guild, GuildMember, GuildMessage, GuildAnnouncement, GuildInvite, PortfolioHolding]),
    forwardRef(() => GatewayModule),
  ],
  controllers: [GuildController],
  providers: [GuildService],
  exports: [GuildService],
})
export class GuildModule {}
