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

  // ── GET /trades/:artworkId/ohlcv ──────────────────────────────────────────

  @Get(':artworkId/ohlcv')
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
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Lịch sử giao dịch raw của 1 artwork',
    description:
      'Query trực tiếp bảng trades trong ClickHouse. ' +
      'Chỉ dùng cho trang detail artwork — không dùng cho chart. ' +
      'Pagination bằng limit + offset (TODO: upgrade cursor-based).',
  })
  @ApiParam({ name: 'artworkId', description: 'UUID artwork' })
  @ApiQuery({ name: 'limit',  type: Number, required: false, description: 'Số records (default 50, max 200)' })
  @ApiQuery({ name: 'offset', type: Number, required: false })
  @ApiResponse({ status: 200, description: 'Mảng giao dịch sorted DESC theo timestamp' })
  async getHistory(
    @Param('artworkId')                     artworkId: string,
    @Query('limit',  new DefaultValuePipe(50),  ParseIntPipe) limit:  number,
    @Query('offset', new DefaultValuePipe(0),   ParseIntPipe) offset: number,
  ) {
    return this.tradesService.getTradeHistory(artworkId, Math.min(limit, 200), offset);
  }

  // ── GET /trades/:artworkId/volume ─────────────────────────────────────────

  @Get(':artworkId/volume')
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

  // ── GET /trades/leaderboard ───────────────────────────────────────────────

  @Get('leaderboard')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Top artworks theo volume 7 ngày',
    description:
      'Dữ liệu cho leaderboard trang chủ. ' +
      'Query Materialized View volume_daily. ' +
      'TTL cache Redis: 5 phút (TODO: thêm Redis caching layer).',
  })
  @ApiQuery({ name: 'limit', type: Number, required: false, description: 'Số artworks (default 20)' })
  @ApiResponse({ status: 200, description: 'Mảng { artwork_id, volume_eth, trade_count } sorted DESC' })
  async getLeaderboard(
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.tradesService.getTopByVolume(Math.min(limit, 100));
  }
}
