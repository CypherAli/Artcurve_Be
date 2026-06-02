import {
  Controller,
  Get,
  Patch,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  DefaultValuePipe,
  ParseIntPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { UsersService }    from './users.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { CurrentUser, Public } from '../auth/decorators';
import { User }            from './entities/user.entity';

@ApiTags('Users')
@ApiBearerAuth('JWT-auth')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  // ─── GET /users/me ─────────────────────────────────────────────────────────

  @Get('me')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Lấy profile của user đang đăng nhập',
    description: 'Trả về thông tin profile: username, bio, avatar, twitter. Yêu cầu JWT.',
  })
  @ApiResponse({
    status: 200,
    description: 'Profile của user',
    schema: {
      example: {
        id: 'uuid',
        wallet_address: '0xAbCd...1234',
        username: 'whale_artist',
        bio: 'Digital artist on Base',
        avatar_url: 'https://...',
        twitter_handle: 'whale_artist',
        is_verified: false,
        role: 'user',
        created_at: '2026-01-01T00:00:00.000Z',
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Chưa đăng nhập' })
  async getMe(@CurrentUser() user: User) {
    return this.usersService.getProfile(user.id);
  }

  // ─── PATCH /users/me ───────────────────────────────────────────────────────

  @Patch('me')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cập nhật profile của user đang đăng nhập',
    description: 'Chỉ cập nhật các field được truyền. Không cập nhật được wallet_address, role, is_verified.',
  })
  @ApiResponse({ status: 200, description: 'Profile sau khi cập nhật' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Chưa đăng nhập' })
  async updateMe(@CurrentUser() user: User, @Body() dto: UpdateProfileDto) {
    return this.usersService.updateProfile(user.id, dto);
  }

  // ─── GET /users/top-creators ───────────────────────────────────────────────

  @Get('top-creators')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Top creators theo số artwork đã deploy',
    description: 'Dùng cho homepage và marketplace sidebar. Public — không cần auth.',
  })
  @ApiQuery({ name: 'limit', type: Number, required: false, example: 10 })
  @ApiResponse({ status: 200, description: 'Danh sách top creators' })
  async getTopCreators(
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
  ) {
    return this.usersService.getTopCreators(limit);
  }

  // ─── GET /users/:walletAddress ─────────────────────────────────────────────

  @Get(':walletAddress')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Public profile theo wallet address',
    description: 'Dùng cho trang creator profile. Public — không cần auth.',
  })
  @ApiParam({ name: 'walletAddress', example: '0xAbCd1234567890AbCd1234567890AbCd12345678' })
  @ApiResponse({ status: 200, description: 'Public profile của user' })
  @ApiResponse({ status: 404, description: 'User không tồn tại' })
  async getByWallet(@Param('walletAddress') walletAddress: string) {
    return this.usersService.getPublicProfile(walletAddress);
  }
}
