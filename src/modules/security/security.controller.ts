import { Controller, Get, Query, DefaultValuePipe, ParseIntPipe } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger'
import { SecurityService } from './security.service'
import { Roles } from '../../common/decorators'

@ApiTags('Security')
@Controller('security')
export class SecurityController {
  constructor(private readonly securityService: SecurityService) {}

  @Get('events')
  @Roles('admin')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Lịch sử sự kiện bảo mật (login failed, brute-force block, suspicious activity...)',
    description: 'Chỉ admin — dùng cho audit log / back-office security dashboard.',
  })
  @ApiQuery({ name: 'limit', type: Number, required: false, example: 50 })
  getRecentEvents(
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
  ) {
    return this.securityService.getRecentEvents(Math.min(limit, 200))
  }
}
