import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Guild } from './entities/guild.entity';
import { GuildMember } from './entities/guild-member.entity';
import { GuildMessage } from './entities/guild-message.entity';
import { PortfolioHolding } from '../portfolio/entities/portfolio-holding.entity';
import { GuildService } from './guild.service';
import { GuildController } from './guild.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Guild, GuildMember, GuildMessage, PortfolioHolding]),
  ],
  controllers: [GuildController],
  providers: [GuildService],
  exports: [GuildService],
})
export class GuildModule {}
