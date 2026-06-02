import { Controller, Post, Delete, Get, Param } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger'
import { SocialService } from './social.service'
import { CurrentUser }   from '../../common/decorators'
import { JwtPayload }    from '../auth/auth.service'

@ApiTags('Social')
@Controller('social')
export class SocialController {
  constructor(private readonly socialService: SocialService) {}

  // JwtAuthGuard is already applied globally via APP_GUARD in AuthModule
  // — no need for @UseGuards() here. Routes below that need auth use @CurrentUser().
  // Public routes (getFollowers, getFollowing, likeCount) work without a token.

  @Post('follow/:userId')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Follow một user' })
  follow(@Param('userId') userId: string, @CurrentUser() user: JwtPayload) {
    return this.socialService.follow(user.sub, userId)
  }

  @Delete('follow/:userId')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Unfollow một user' })
  unfollow(@Param('userId') userId: string, @CurrentUser() user: JwtPayload) {
    return this.socialService.unfollow(user.sub, userId)
  }

  @Get('followers/:userId')
  @ApiOperation({ summary: 'Danh sách followers của một user' })
  getFollowers(@Param('userId') userId: string) {
    return this.socialService.getFollowers(userId)
  }

  @Get('following/:userId')
  @ApiOperation({ summary: 'Danh sách user đang follow' })
  getFollowing(@Param('userId') userId: string) {
    return this.socialService.getFollowing(userId)
  }

  @Post('like/:artworkId')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Like một artwork' })
  like(@Param('artworkId') artworkId: string, @CurrentUser() user: JwtPayload) {
    return this.socialService.likeArtwork(user.sub, artworkId)
  }

  @Delete('like/:artworkId')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Unlike một artwork' })
  unlike(@Param('artworkId') artworkId: string, @CurrentUser() user: JwtPayload) {
    return this.socialService.unlikeArtwork(user.sub, artworkId)
  }

  @Get('likes/:artworkId/count')
  @ApiOperation({ summary: 'Số lượt like của artwork' })
  likeCount(@Param('artworkId') artworkId: string) {
    return this.socialService.getLikeCount(artworkId)
  }
}
