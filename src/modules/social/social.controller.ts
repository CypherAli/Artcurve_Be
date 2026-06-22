import {
  Controller, Post, Delete, Get,
  Param, Body, Query,
} from '@nestjs/common'
import {
  ApiTags, ApiOperation, ApiBearerAuth, ApiBody, ApiQuery,
} from '@nestjs/swagger'
import { IsString, IsNotEmpty, IsOptional, IsInt, Min, Max, MaxLength } from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import { SocialService } from './social.service'
import { CurrentUser, Public } from '../../common/decorators'
import { JwtPayload }    from '../auth/auth.service'

// ── DTOs ─────────────────────────────────────────────────────────────

class CreateCommentDto {
  @ApiProperty({ description: 'Nội dung review / comment', maxLength: 1000 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  content: string

  @ApiPropertyOptional({ description: 'Rating 1–5 sao (tùy chọn)', minimum: 1, maximum: 5 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number
}

// ── Controller ────────────────────────────────────────────────────────

@ApiTags('Social')
@Controller('social')
export class SocialController {
  constructor(private readonly socialService: SocialService) {}

  // ── Follow ────────────────────────────────────────────────────────

  @Post('follow/:userId')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Follow một user' })
  follow(@Param('userId') userId: string, @CurrentUser() user: JwtPayload) {
    return this.socialService.follow(user.sub, userId)
  }

  @Delete('follow/:userId')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Unfollow một user' })
  unfollow(@Param('userId') userId: string, @CurrentUser() user: JwtPayload) {
    return this.socialService.unfollow(user.sub, userId)
  }

  @Get('followers/:userId')
  @Public()
  @ApiOperation({ summary: 'Danh sách followers của một user' })
  getFollowers(@Param('userId') userId: string) {
    return this.socialService.getFollowers(userId)
  }

  @Get('following/:userId')
  @Public()
  @ApiOperation({ summary: 'Danh sách user đang follow' })
  getFollowing(@Param('userId') userId: string) {
    return this.socialService.getFollowing(userId)
  }

  // ── Likes ─────────────────────────────────────────────────────────

  @Post('like/:artworkId')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Like một artwork' })
  like(@Param('artworkId') artworkId: string, @CurrentUser() user: JwtPayload) {
    return this.socialService.likeArtwork(user.sub, artworkId)
  }

  @Delete('like/:artworkId')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Unlike một artwork' })
  unlike(@Param('artworkId') artworkId: string, @CurrentUser() user: JwtPayload) {
    return this.socialService.unlikeArtwork(user.sub, artworkId)
  }

  @Get('likes/:artworkId/count')
  @Public()
  @ApiOperation({ summary: 'Số lượt like của artwork' })
  likeCount(@Param('artworkId') artworkId: string) {
    return this.socialService.getLikeCount(artworkId)
  }

  // ── Comments / Reviews ────────────────────────────────────────────

  @Post('comment/:artworkId')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Viết review + rating cho artwork (COMMENT)' })
  @ApiBody({ type: CreateCommentDto })
  createComment(
    @Param('artworkId') artworkId: string,
    @Body() dto: CreateCommentDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.socialService.createComment(user.sub, artworkId, dto.content, dto.rating)
  }

  @Get('comments/:artworkId')
  @Public()
  @ApiOperation({ summary: 'Lấy danh sách reviews của artwork' })
  @ApiQuery({ name: 'page',  required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  getComments(
    @Param('artworkId') artworkId: string,
    @Query('page')  page  = 1,
    @Query('limit') limit = 20,
  ) {
    return this.socialService.getComments(artworkId, Number(page), Number(limit))
  }

  @Delete('comment/:commentId')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Xóa comment / review của chính mình' })
  deleteComment(
    @Param('commentId') commentId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.socialService.deleteComment(user.sub, commentId)
  }

  @Get('stats/:artworkId')
  @Public()
  @ApiOperation({ summary: 'Thống kê like + comment + avg_rating của artwork' })
  getStats(@Param('artworkId') artworkId: string) {
    return this.socialService.getArtworkStats(artworkId)
  }
}
