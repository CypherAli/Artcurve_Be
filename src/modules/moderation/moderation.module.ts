import { Module }               from '@nestjs/common'
import { TypeOrmModule }        from '@nestjs/typeorm'
import { HttpModule }           from '@nestjs/axios'
import { ModerationLog }        from '../artworks/entities/moderation-log.entity'
import { Artwork }              from '../artworks/entities/artwork.entity'
import { ModerationService }    from './moderation.service'
import { ModerationController } from './moderation.controller'

@Module({
  imports:     [TypeOrmModule.forFeature([ModerationLog, Artwork]), HttpModule],
  controllers: [ModerationController],
  providers:   [ModerationService],
  exports:     [ModerationService],
})
export class ModerationModule {}
