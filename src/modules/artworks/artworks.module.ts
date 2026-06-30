import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { Artwork } from './entities/artwork.entity';
import { ModerationLog } from './entities/moderation-log.entity';
import { Transaction } from '../trades/entities/transaction.entity';
import { ArtworksService } from './artworks.service';
import { ArtworksController } from './artworks.controller';
import { PinataService } from './pinata.service';
import { ArtworkRepository } from './repositories/artwork.repository';

@Module({
  imports: [
    TypeOrmModule.forFeature([Artwork, Transaction, ModerationLog]),
    ConfigModule,   // inject ConfigService vào PinataService + AI_SERVICE_URL
  ],
  controllers: [ArtworksController],
  providers: [ArtworksService, PinataService, ArtworkRepository],
  exports: [ArtworksService, PinataService, ArtworkRepository],
})
export class ArtworksModule {}
