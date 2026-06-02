import {
  Controller,
  Get,
  Param,
  Query,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  DefaultValuePipe,
  ParseIntPipe,
  ForbiddenException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { PortfolioService } from './portfolio.service';
import { CurrentUser, Roles } from '../auth/decorators';
import { User } from '../users/entities/user.entity';

@ApiTags('Portfolio')
@ApiBearerAuth('JWT-auth')
@Controller('portfolio')
export class PortfolioController {
  constructor(private readonly portfolioService: PortfolioService) {}

  // ─── GET /portfolio/me/pnl — PnL của chính mình ───────────────────────────

  @Get('me/pnl')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Tính P&L portfolio của user đang đăng nhập',
    description:
      'Tất cả phép tính dùng Decimal.js — không có JS float error. ' +
      'Trả về lãi/lỗ từng artwork + tổng portfolio.',
  })
  @ApiResponse({
    status: 200,
    description: 'Portfolio P&L',
    schema: {
      example: {
        user_id: 'uuid',
        total_current_value_eth: '0.12345678',
        total_cost_basis_eth: '0.10000000',
        total_unrealized_pnl_eth: '0.02345678',
        total_unrealized_pnl_pct: '23.46',
        holdings: [
          {
            artwork_id: 'uuid',
            artwork_title: 'Genesis',
            share_balance: '10.00000000',
            avg_buy_price: '0.00100000',
            current_price: '0.00123457',
            current_value_eth: '0.01234570',
            cost_basis_eth: '0.01000000',
            unrealized_pnl_eth: '0.00234570',
            unrealized_pnl_pct: '23.46',
          },
        ],
      },
    },
  })
  async getMyPnL(@CurrentUser() user: User) {
    return this.portfolioService.calculatePortfolioPnL(user.id);
  }

  // ─── GET /portfolio/:userId/pnl — Admin xem P&L của user khác ─────────────

  @Get(':userId/pnl')
  @Roles('admin')           // Chỉ admin mới xem được portfolio của người khác
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '[Admin] Xem P&L portfolio của bất kỳ user nào',
    description: 'Yêu cầu role = admin. Dùng cho dashboard quản trị.',
  })
  @ApiParam({ name: 'userId', type: String })
  @ApiResponse({ status: 200, description: 'Portfolio P&L của user chỉ định' })
  @ApiResponse({ status: 403, description: 'Không đủ quyền' })
  async getUserPnL(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.portfolioService.calculatePortfolioPnL(userId);
  }

  // ─── GET /portfolio/artworks/:artworkId/holders — Top Holders ─────────────

  @Get('artworks/:artworkId/holders')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Top holders của một artwork — Leaderboard',
    description:
      'Dùng window function RANK() trong PostgreSQL. ' +
      'Tính ownership % với NUMERIC — không qua JS float.',
  })
  @ApiParam({ name: 'artworkId', type: String })
  @ApiQuery({ name: 'limit', type: Number, required: false, example: 10 })
  @ApiResponse({
    status: 200,
    description: 'Danh sách top holders',
    schema: {
      example: [
        {
          rank: 1,
          wallet_address: '0xAbCd...',
          username: 'whale_artist',
          share_balance: '500.00000000',
          ownership_pct: '50.00',
        },
      ],
    },
  })
  async getTopHolders(
    @Param('artworkId', ParseUUIDPipe) artworkId: string,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
  ) {
    return this.portfolioService.getTopHolders(artworkId, Math.min(limit, 50));
  }

  // ─── GET /portfolio/me/holdings/:artworkId — Holding cụ thể ───────────────

  @Get('me/holdings/:artworkId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Lấy số dư của user hiện tại cho một artwork cụ thể',
    description: 'Dùng composite index idx_user_portfolio(user_id, artwork_id) → O(log n).',
  })
  @ApiParam({ name: 'artworkId', type: String })
  @ApiResponse({ status: 200, description: 'Thông tin holding hoặc null nếu chưa mua' })
  async getMyHolding(
    @CurrentUser() user: User,
    @Param('artworkId', ParseUUIDPipe) artworkId: string,
  ) {
    return this.portfolioService.getUserHolding(user.id, artworkId);
  }
}
