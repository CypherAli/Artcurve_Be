import {
  Controller,
  Get,
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
  ApiQuery,
} from '@nestjs/swagger';
import { VaultService } from './vault.service';
import { CurrentUser } from '../auth/decorators';

// ─────────────────────────────────────────────────────────────────────────────
//  VaultController
//
//  Aggregated portfolio view cho /vault page trên Frontend.
//  Tất cả endpoints yêu cầu JWT Bearer token.
//
//  Routes:
//    GET /vault/overview          — tổng quan portfolio (value, P&L, ETH balance)
//    GET /vault/holdings          — danh sách holdings enriched
//    GET /vault/transactions      — lịch sử giao dịch có filter buy/sell
//    GET /vault/performance       — daily portfolio snapshots theo period
// ─────────────────────────────────────────────────────────────────────────────

@ApiTags('Vault')
@ApiBearerAuth('JWT-auth')
@Controller('vault')
export class VaultController {
  constructor(private readonly vaultService: VaultService) {}

  // ── GET /vault/overview ───────────────────────────────────────────────────

  @Get('overview')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Portfolio overview — total value, unrealized/realized P&L, ETH balance',
    description:
      'Aggregate toàn bộ holdings + realized P&L từ sell transactions. ' +
      'Tất cả phép tính dùng Decimal.js — không có JS float error.',
  })
  @ApiResponse({
    status: 200,
    description: 'Portfolio overview',
    schema: {
      example: {
        total_value_eth: '1.23456789',
        total_cost_basis_eth: '1.00000000',
        unrealized_pnl_eth: '0.23456789',
        unrealized_pnl_pct: '23.46',
        realized_pnl_eth: '0.05000000',
        eth_balance: '0.00000000',
        holdings_count: 5,
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getOverview(@CurrentUser() user: { id: string }) {
    return this.vaultService.getOverview(user.id);
  }

  // ── GET /vault/holdings ───────────────────────────────────────────────────

  @Get('holdings')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Enriched holdings list — artwork info, qty, prices, P&L',
    description:
      'Trả về danh sách holdings kèm artwork name, ticker, category, ' +
      'qty, avg buy price, current price, value, P&L. Sorted by value DESC.',
  })
  @ApiResponse({
    status: 200,
    description: 'Holdings list',
    schema: {
      example: [
        {
          artwork_id: 'uuid',
          title: 'Genesis',
          ticker: 'GEN',
          category: 'digital_art',
          image_uri: 'ipfs://...',
          share_balance: '10.00000000',
          avg_buy_price: '0.00100000',
          current_price: '0.00123457',
          value_eth: '0.01234570',
          cost_basis_eth: '0.01000000',
          pnl_eth: '0.00234570',
          pnl_pct: '23.46',
        },
      ],
    },
  })
  async getHoldings(@CurrentUser() user: { id: string }) {
    return this.vaultService.getHoldings(user.id);
  }

  // ── GET /vault/transactions ───────────────────────────────────────────────

  @Get('transactions')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Transaction history — paginated, filterable by buy/sell',
    description:
      'Lịch sử giao dịch của user kèm artwork info. ' +
      'Có thể filter theo side (buy/sell). Sorted DESC theo timestamp.',
  })
  @ApiQuery({ name: 'page', type: Number, required: false, example: 1 })
  @ApiQuery({ name: 'limit', type: Number, required: false, example: 20 })
  @ApiQuery({
    name: 'side',
    required: false,
    enum: ['buy', 'sell'],
    description: 'Filter by transaction side',
  })
  @ApiResponse({
    status: 200,
    description: 'Paginated transaction history',
    schema: {
      example: {
        data: [],
        total: 0,
        page: 1,
        totalPages: 0,
      },
    },
  })
  async getTransactions(
    @CurrentUser() user: { id: string },
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('side') side?: 'buy' | 'sell',
  ) {
    return this.vaultService.getTransactionHistory(
      user.id,
      page,
      Math.min(limit, 100),
      side,
    );
  }

  // ── GET /vault/performance ────────────────────────────────────────────────

  @Get('performance')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Portfolio performance — daily value snapshots',
    description:
      'Trả về daily portfolio value snapshots cho chart. ' +
      'Hỗ trợ period: 7d, 30d, 90d. ' +
      'Reconstructed từ transactions (không cần snapshot table).',
  })
  @ApiQuery({
    name: 'period',
    required: false,
    enum: ['7d', '30d', '90d'],
    example: '30d',
  })
  @ApiResponse({
    status: 200,
    description: 'Daily portfolio value points',
    schema: {
      example: [
        { date: '2025-06-01', value_eth: '1.20000000' },
        { date: '2025-06-02', value_eth: '1.25000000' },
      ],
    },
  })
  async getPerformance(
    @CurrentUser() user: { id: string },
    @Query('period') period?: string,
  ) {
    const validPeriods = ['7d', '30d', '90d'] as const;
    const p = validPeriods.includes(period as any)
      ? (period as '7d' | '30d' | '90d')
      : '30d';
    return this.vaultService.getPerformance(user.id, p);
  }
}
