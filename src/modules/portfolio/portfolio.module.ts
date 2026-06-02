import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PortfolioHolding } from './entities/portfolio-holding.entity';
import { Artwork } from '../artworks/entities/artwork.entity';
import { PortfolioService } from './portfolio.service';
import { PortfolioController } from './portfolio.controller';
import { PortfolioHoldingRepository } from './repositories/portfolio-holding.repository';

@Module({
  imports: [TypeOrmModule.forFeature([PortfolioHolding, Artwork])],
  controllers: [PortfolioController],
  providers: [PortfolioService, PortfolioHoldingRepository],
  exports: [PortfolioService, PortfolioHoldingRepository],
})
export class PortfolioModule {}
