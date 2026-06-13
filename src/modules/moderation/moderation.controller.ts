import { Controller, Post, Get, Param, Body } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger'
import { ModerationService } from './moderation.service'
import { Roles } from '../../common/decorators'

@ApiTags('Moderation')
@Controller('moderation')
export class ModerationController {
  constructor(private readonly moderationService: ModerationService) {}

  @Post(':artworkId')
  @Roles('admin')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Submit artwork for AI moderation' })
  moderate(
    @Param('artworkId') artworkId: string,
    @Body('image_url') imageUrl: string,
  ) {
    return this.moderationService.moderateArtwork(artworkId, imageUrl)
  }

  @Get(':artworkId/logs')
  @Roles('admin')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Get moderation log for an artwork' })
  getLogs(@Param('artworkId') artworkId: string) {
    return this.moderationService.getLogs(artworkId)
  }
}
