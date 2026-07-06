import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { Artwork } from '../artworks/entities/artwork.entity';
import { DiscoveryService } from './discovery.service';
import { DiscoveryController } from './discovery.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Artwork]), HttpModule],
  providers: [DiscoveryService],
  controllers: [DiscoveryController],
  exports: [DiscoveryService], // để moderation/artworks gọi fingerprint + dup-guard
})
export class DiscoveryModule {}
