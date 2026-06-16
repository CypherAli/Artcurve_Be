import {
  Controller,
  Get,
  Param,
  Query,
  ParseIntPipe,
  DefaultValuePipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { TradesService } from './trades.service';
import { Public, CurrentUser } from '../auth/decorators';
import type { OhlcvTimeframe } from '../../shared/clickhouse/clickhouse-infra.service';

// ─────────────────────────────────────────────────────────────────────────────
//  TradesController  (src/modules/trades/)
//
//  REST endpoints cho lịch sử giao dịch và dữ liệu chart (CHỈ ĐỌC).
//
//  Routes:
//    GET /trades/:artworkId/ohlcv      — OHLCV candles cho chart
//    GET /trades/:artworkId/history    — Lịch sử giao dịch raw
//    GET /trades/:artworkId/volume     — Volume 24h
//    GET /trades/leaderboard           — Top artworks theo volume 7 ngày
//
//  Authentication: JWT bắt buộc (JwtAuthGuard global từ AuthModule).
//  Tất cả routes yêu cầu Bearer token trừ khi có @Public().
// ─────────────────────────────────────────────────────────────────────────────

@ApiTags('Trades — History & Chart Data')
@ApiBearerAuth('JWT-auth')
@Controller('trades')
export class TradesController {
  constructor(private readonly tradesService: TradesService) {}

  // ── GET /trades/leaderboard ─── PHẢI đặt TRƯỚC /:artworkId/* ─────────────
  // Express match route theo thứ tự. Nếu đặt sau, "leaderboard" bị nuốt vào :artworkId.

  @Get('recent')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Giao dịch gần nhất toàn sàn — dùng cho Live Activity feed' })
  @ApiQuery({ name: 'limit', type: Number, required: false })
  @ApiResponse({ status: 200, description: 'Mảng transaction sorted DESC theo timestamp' })
  async getRecentTrades(
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.tradesService.getRecentTrades(limit);
  }

  @Get('leaderboard')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Top artworks theo volume 7 ngày',
    description: 'Query Materialized View volume_daily. Public — không cần auth.',
  })
  @ApiQuery({ name: 'limit', type: Number, required: false })
  @ApiResponse({ status: 200, description: 'Mảng { artwork_id, volume_eth, trade_count } sorted DESC' })
  async getLeaderboard(
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.tradesService.getTopByVolume(Math.min(limit, 100));
  }

  // ── GET /trades/me/history ────────────────────────────────────────────────
  // PHẢI đặt TRƯỚC /:artworkId/* để "me" không bị parse thành artworkId.

  @Get('me/history')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Lịch sử giao dịch của user đang đăng nhập',
    description:
      'Query PostgreSQL transactions table WHERE user_id = currentUser. ' +
      'Trả về danh sách kèm artwork info, sorted DESC theo timestamp. ' +
      'Yêu cầu JWT Bearer token.',
  })
  @ApiQuery({ name: 'cursor', type: String, required: false, description: 'Keyset cursor (production scale). Có cursor → bỏ qua page.' })
  @ApiQuery({ name: 'page',  type: Number, required: false, example: 1, description: 'Legacy OFFSET' })
  @ApiQuery({ name: 'limit', type: Number, required: false, example: 20 })
  @ApiResponse({
    status: 200,
    description: 'Cursor mode: { data, next_cursor, has_more }. Legacy: { data, total, page, totalPages }.',
  })
  @ApiResponse({ status: 401, description: 'Chưa đăng nhập' })
  async getMyTransactionHistory(
    @CurrentUser() user: { sub: string },
    @Query('page',  new DefaultValuePipe(1),  ParseIntPipe) page:  number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('cursor') cursor?: string,
  ) {
    const cappedLimit = Math.min(limit, 100);
    if (cursor !== undefined) {
      return this.tradesService.getUserTransactionHistoryCursor(user.sub, cappedLimit, cursor || undefined);
    }
    return this.tradesService.getUserTransactionHistory(user.sub, page, cappedLimit);
  }

  // ── GET /trades/:artworkId/ohlcv ──────────────────────────────────────────

  @Get(':artworkId/ohlcv')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Lấy OHLCV candles cho candlestick chart',
    description:
      'Query từ Materialized View ClickHouse đã pre-compute. ' +
      'Không aggregate từ raw trades → latency < 10ms. ' +
      'Frontend dùng để vẽ TradingView Lightweight Charts.',
  })
  @ApiParam({
    name:        'artworkId',
    description: 'UUID của artwork trong PostgreSQL',
    example:     'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  @ApiQuery({ name: 'timeframe', enum: ['1m', '5m', '15m', '1h', '4h', '1d'], required: false })
  @ApiQuery({ name: 'from',      type: String,  required: false, description: 'ISO-8601 datetime' })
  @ApiQuery({ name: 'to',        type: String,  required: false, description: 'ISO-8601 datetime' })
  @ApiQuery({ name: 'limit',     type: Number,  required: false, description: 'Max candles (default 500)' })
  @ApiResponse({ status: 200, description: 'Mảng OhlcvCandle sorted ASC theo thời gian' })
  async getOhlcv(
    @Param('artworkId')                    artworkId: string,
    @Query('timeframe')                    timeframe: OhlcvTimeframe = '1m',
    @Query('from')                         fromStr?: string,
    @Query('to')                           toStr?:   string,
    @Query('limit', new DefaultValuePipe(500), ParseIntPipe) limit?: number,
  ) {
    const { from, to } = this.tradesService.parseTimeRange(fromStr, toStr);
    return this.tradesService.getOhlcv({ artworkId, timeframe, from, to, limit });
  }

  // ── GET /trades/:artworkId/history ────────────────────────────────────────

  @Get(':artworkId/history')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Lịch sử giao dịch raw của 1 artwork',
    description:
      'Query trực tiếp bảng trades trong ClickHouse. ' +
      'Chỉ dùng cho trang detail artwork — không dùng cho chart. ' +
      'Trả về pagination wrapper { data, total, page, limit } — consistent với /artworks/:id/history.',
  })
  @ApiParam({ name: 'artworkId', description: 'UUID artwork' })
  @ApiQuery({ name: 'page',  type: Number, required: false, description: 'Trang (default 1)' })
  @ApiQuery({ name: 'limit', type: Number, required: false, description: 'Số records mỗi trang (default 50, max 200)' })
  @ApiResponse({
    status: 200,
    description: 'Lịch sử giao dịch có phân trang',
    schema: {
      example: {
        data: [],
        total: 0,
        page: 1,
        limit: 50,
      },
    },
  })
  async getHistory(
    @Param('artworkId')                      artworkId: string,
    @Query('page',  new DefaultValuePipe(1),  ParseIntPipe) page:  number,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
  ) {
    return this.tradesService.getTradeHistoryPaginated(artworkId, page, Math.min(limit, 200));
  }

  // ── GET /trades/:artworkId/volume ─────────────────────────────────────────

  @Get(':artworkId/volume')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Volume 24h của 1 artwork (fallback khi Redis cache miss)',
    description: 'Query từ Materialized View volume_daily trong ClickHouse.',
  })
  @ApiResponse({ status: 200, schema: { example: { volume_eth: '1230000000000000000' } } })
  async getVolume24h(@Param('artworkId') artworkId: string) {
    const volume = await this.tradesService.getVolume24h(artworkId);
    return { volume_eth: volume };
  }

}
