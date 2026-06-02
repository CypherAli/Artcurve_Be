import { Module }            from '@nestjs/common'
import { TypeOrmModule }     from '@nestjs/typeorm'
import { Follower }          from './entities/follower.entity'
import { SocialInteraction } from './entities/social-interaction.entity'
import { SocialService }     from './social.service'
import { SocialController }  from './social.controller'

@Module({
  imports:     [TypeOrmModule.forFeature([Follower, SocialInteraction])],
  controllers: [SocialController],
  providers:   [SocialService],
  exports:     [SocialService],
})
export class SocialModule {}
