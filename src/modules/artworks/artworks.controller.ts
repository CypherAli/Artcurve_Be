import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  DefaultValuePipe,
  ParseIntPipe,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
  ApiConsumes,
  ApiBody,
} from '@nestjs/swagger';
import { ArtworksService } from './artworks.service';
import { ArtworkStatus, ArtworkType } from './entities/artwork.entity';
import {
  CreateArtworkDto,
  UpdateArtworkStatusDto,
  SearchArtworksDto,
} from './dto/create-artwork.dto';
import { CurrentUser, Public } from '../auth/decorators';
import { ClickHouseService, OhlcvInterval } from '../../shared/clickhouse/clickhouse.service';
import { CurveEngineService } from '../../shared/curve-engine/curve-engine.service';
import { OnchainQuoteService } from '../../shared/onchain-quote/onchain-quote.service';
import { User } from '../users/entities/user.entity';

@ApiTags('Artworks')
@ApiBearerAuth('JWT-auth')
@Controller('artworks')
export class ArtworksController {
  constructor(
    private readonly artworksService:   ArtworksService,
    private readonly clickHouseService: ClickHouseService,
    private readonly curveEngine:       CurveEngineService,
    private readonly onchainQuote:      OnchainQuoteService,
  ) {}

  // ─── GET /artworks — Marketplace listing ──────────────────────────────────

  @Get()
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Marketplace — danh sách artworks ACTIVE',
    description:
      'Dùng partial index idx_artworks_active_price — chỉ scan ACTIVE rows. ' +
      'Hỗ trợ sort theo price | created_at | view_count.',
  })
  @ApiQuery({ name: 'sortBy', enum: ['price', 'created_at', 'view_count', 'trending'], required: false })
  @ApiQuery({ name: 'cursor', type: String, required: false, description: 'Keyset cursor (chỉ cho sortBy=created_at). Có cursor → infinite scroll, bỏ qua page.' })
  @ApiQuery({ name: 'artwork_type', enum: ArtworkType, required: false, description: 'Lọc: ORIGINAL, AI_GENERATED, AI_ASSISTED' })
  @ApiQuery({ name: 'page',   type: Number, required: false, example: 1 })
  @ApiQuery({ name: 'limit',  type: Number, required: false, example: 20 })
  @ApiResponse({ status: 200, description: 'Cursor mode (created_at): { data, next_cursor, has_more }. Legacy: { data, total, page }.' })
  async getMarketplace(
    @Query('sortBy') sortBy: 'price' | 'created_at' | 'view_count' | 'trending' = 'created_at',
    @Query('page',  new DefaultValuePipe(1),  ParseIntPipe) page:  number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('cursor') cursor?: string,
    @Query('artwork_type') artworkType?: ArtworkType,
  ) {
    const validType = artworkType && Object.values(ArtworkType).includes(artworkType)
      ? artworkType : undefined;
    const cappedLimit = Math.min(limit, 100);
    if (cursor !== undefined && sortBy === 'created_at') {
      return this.artworksService.getMarketplaceCursor(cappedLimit, cursor || undefined, validType);
    }
    return this.artworksService.getMarketplace(sortBy, page, cappedLimit, validType);
  }

  // ─── GET /artworks/search — Full-text + filter ────────────────────────────

  @Get('search')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Tìm kiếm artworks — full-text + filter category, curve_type',
    description:
      'Keyword search trên title, description, ticker. ' +
      'Filter theo category và curve_type. Chỉ trả về ACTIVE artworks.',
  })
  @ApiQuery({ name: 'q',          type: String, required: false, example: 'genesis' })
  @ApiQuery({ name: 'category',   enum: ['Painting','Drawing','Digital','Photography','Sculpture','Mixed Media','Generative'], required: false })
  @ApiQuery({ name: 'curve_type', enum: ['linear','quadratic','exponential'], required: false })
  @ApiQuery({ name: 'sortBy',     enum: ['price','created_at','view_count','supply'], required: false })
  @ApiQuery({ name: 'page',       type: Number, required: false })
  @ApiQuery({ name: 'limit',      type: Number, required: false })
  @ApiResponse({ status: 200, description: 'Search results' })
  async search(@Query() dto: SearchArtworksDto) {
    return this.artworksService.searchArtworks(dto);
  }

  // ─── GET /artworks/my — Creator's own artworks ────────────────────────────

  @Get('my')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Danh sách artworks của creator đang đăng nhập',
    description: 'Trả về TẤT CẢ status kể cả DRAFT, AI_MODERATING. Yêu cầu JWT.',
  })
  @ApiResponse({ status: 200, description: 'Danh sách artworks của creator' })
  @ApiResponse({ status: 401, description: 'Chưa đăng nhập' })
  async getMyArtworks(@CurrentUser() user: User) {
    return this.artworksService.getMyArtworks(user.id);
  }

  // ─── GET /artworks/stats — Platform stats ─────────────────────────────────

  @Get('stats')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Platform stats — artwork count, total volume ETH, collector count' })
  @ApiResponse({ status: 200, description: 'Platform statistics' })
  async getPlatformStats() {
    return this.artworksService.getPlatformStats();
  }

  // ─── GET /artworks/:id/quote — Buy/Sell price quote ─────────────────────

  @Get(':id/quote')
  @Public()
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Tính giá mua/bán token trước khi submit giao dịch',
    description: 'Trả về ETH cost (buy) hoặc ETH return (sell) dựa trên bonding curve của artwork.',
  })
  @ApiParam({ name: 'id', type: String })
  @ApiQuery({ name: 'action', enum: ['buy', 'sell'], required: true })
  @ApiQuery({ name: 'amount', type: Number, required: true, description: 'Số token muốn mua/bán' })
  @ApiResponse({ status: 200, description: 'Quote result' })
  async getQuote(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('action') action: 'buy' | 'sell',
    @Query('amount', ParseIntPipe) amount: number,
  ) {
    if (amount <= 0) throw new BadRequestException('Amount must be positive');
    const artwork = await this.artworksService.getArtworkById(id);
    if (artwork.status !== ArtworkStatus.ACTIVE) throw new BadRequestException('Can only quote ACTIVE artworks');

    // On-chain quote (matches actual execution price) when AMM is deployed
    if (artwork.amm_address) {
      try {
        return action === 'sell'
          ? await this.onchainQuote.getSellQuote(artwork.amm_address, amount)
          : await this.onchainQuote.getBuyQuote(artwork.amm_address, amount);
      } catch (err) {
        // Fallback to off-chain engine if RPC fails
      }
    }

    // Fallback: off-chain curve engine (for artworks not yet deployed)
    const params  = this.curveEngine.paramsFromArtwork(artwork);
    const supply  = parseFloat(artwork.current_supply) || 0;
    return action === 'sell'
      ? this.curveEngine.getSellReturn(params, supply, amount)
      : this.curveEngine.getBuyCost(params, supply, amount);
  }

  // ─── GET /artworks/:id/curve — Price curve points for chart ──────────────

  @Get(':id/curve')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Lấy điểm vẽ đường cong bonding curve (dùng cho chart preview)',
    description: 'Trả về mảng {supply, price} để vẽ bonding curve trên FE.',
  })
  @ApiParam({ name: 'id', type: String })
  @ApiQuery({ name: 'points', type: Number, required: false, description: 'Số điểm (mặc định 50, tối đa 500)' })
  @ApiResponse({ status: 200, description: 'Array of {supply, price}' })
  async getPriceCurve(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('points', new DefaultValuePipe(50), ParseIntPipe) points: number,
  ) {
    const artwork = await this.artworksService.getArtworkById(id);
    const params  = this.curveEngine.paramsFromArtwork(artwork);
    return this.curveEngine.getPriceCurve(params, points);
  }

  // ─── GET /artworks/:id — Artwork detail ───────────────────────────────────
  // QUAN TRỌNG: Route này phải đặt SAU /search và /my để tránh conflict
  // (Express route matching — nếu đặt trước, "search" sẽ bị parse là UUID)

  @Get(':id')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Chi tiết một artwork — dùng cho trade page và artwork detail',
    description:
      'Trả về đầy đủ thông tin artwork kèm creator info. ' +
      'Public — không cần auth.',
  })
  @ApiParam({ name: 'id', description: 'UUID của artwork', type: String })
  @ApiResponse({ status: 200, description: 'Artwork detail' })
  @ApiResponse({ status: 404, description: 'Artwork không tồn tại' })
  async getById(@Param('id', ParseUUIDPipe) id: string) {
    return this.artworksService.getArtworkById(id);
  }

  // ─── POST /artworks — Tạo DRAFT ───────────────────────────────────────────

  @Post()
  @Throttle({ default: { limit: 1, ttl: 1800000 } })
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Tạo artwork mới (status = DRAFT)',
    description:
      'Lưu metadata vào DB với trạng thái DRAFT. ' +
      'Contract chưa deploy, IPFS chưa pin. ' +
      'Ticker được auto-generate từ title nếu không truyền. ' +
      'Yêu cầu JWT từ /auth/verify.',
  })
  @ApiResponse({ status: 201, description: 'Artwork DRAFT đã được tạo' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Chưa đăng nhập' })
  @ApiResponse({ status: 409, description: 'Ticker đã được sử dụng' })
  async createDraft(@CurrentUser() user: User, @Body() dto: CreateArtworkDto) {
    return this.artworksService.createDraftArtwork(user.id, dto);
  }

  // ─── POST /artworks/upload — Upload image + pin metadata to IPFS ────────────
  // PHẢI đặt TRƯỚC /:id để không bị ParseUUIDPipe bắt "upload" làm UUID

  @Post('upload')
  @Throttle({ default: { limit: 1, ttl: 1800000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Upload ảnh & pin ERC-721 metadata lên IPFS (Pinata)',
    description:
      'Bước chuẩn bị trước khi tạo DRAFT: upload ảnh + auto-tạo metadata JSON. ' +
      'Trả về image_uri và metadata_uri để truyền vào POST /artworks. ' +
      'Yêu cầu JWT từ /auth/verify.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'title'],
      properties: {
        file:        { type: 'string', format: 'binary', description: 'Ảnh tác phẩm (JPEG/PNG/GIF/WebP, tối đa 20MB)' },
        title:       { type: 'string', example: 'Dissolution Study III' },
        description: { type: 'string', example: 'Fractionalized on Base L2' },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'IPFS URIs của ảnh và metadata',
    schema: {
      type: 'object',
      properties: {
        image_uri:          { type: 'string', example: 'ipfs://Qm...' },
        metadata_uri:       { type: 'string', example: 'ipfs://Qm...' },
        gateway_image_url:  { type: 'string', example: 'https://gateway.pinata.cloud/ipfs/Qm...' },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Thiếu file hoặc sai MIME type' })
  @ApiResponse({ status: 401, description: 'Chưa đăng nhập' })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      // Giới hạn chặt cho multipart parsing — multer <2.2.0 có CVE DoS qua
      // nhiều field/field-name lồng nhau (GHSA-72gw-mp4g-v24j, GHSA-5528-5vmv-3xc2).
      // Bản vá thật cần NestJS 11 (breaking change, chưa nâng cấp) — các giới hạn
      // dưới đây là biện pháp phòng thủ giảm bề mặt tấn công trong lúc chờ nâng cấp.
      limits: {
        fileSize:     20 * 1024 * 1024,  // 20MB — 1 file
        files:        1,                 // chỉ 1 file/request
        fields:       5,                 // chỉ có title + description
        fieldNameSize: 100,
        fieldSize:    5000,              // đủ cho description dài
        parts:        10,
      },
      fileFilter: (_req, file, cb) => {
        const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
        if (allowed.includes(file.mimetype)) {
          cb(null, true);
        } else {
          cb(new BadRequestException(`Chỉ chấp nhận JPEG, PNG, GIF, WebP (nhận được: ${file.mimetype})`), false);
        }
      },
    }),
  )
  async uploadMedia(
    @UploadedFile() file: Express.Multer.File,
    @Body('title')       title:       string,
    @Body('description') description: string = '',
  ) {
    if (!file) throw new BadRequestException('Vui lòng chọn file ảnh');
    if (!title?.trim()) throw new BadRequestException('title là bắt buộc');

    // Verify actual file type via magic bytes (client-sent mimetype is spoofable)
    const mime = this.detectImageMime(file.buffer);
    if (!mime) {
      throw new BadRequestException(
        'Invalid file type. Only JPEG, PNG, GIF, WebP are allowed.',
      );
    }

    return this.artworksService.uploadArtworkMedia(file, title.trim(), description);
  }

  // ─── PATCH /artworks/:id/status — State Machine ───────────────────────────

  @Patch(':id/status')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Chuyển trạng thái artwork trong State Machine',
    description:
      'DRAFT → AI_MODERATING → ACTIVE (cần contract_address + ipfs_uri) ' +
      '→ TARGET_REACHED → GRADUATED. ' +
      'Validate transition hợp lệ — không thể nhảy cóc.',
  })
  @ApiParam({ name: 'id', description: 'UUID artwork', type: String })
  @ApiResponse({ status: 200, description: 'Artwork đã chuyển trạng thái' })
  @ApiResponse({ status: 400, description: 'Transition không hợp lệ hoặc thiếu trường bắt buộc' })
  @ApiResponse({ status: 404, description: 'Artwork không tồn tại' })
  async updateStatus(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateArtworkStatusDto,
  ) {
    return this.artworksService.updateArtworkStatus(user.id, id, dto);
  }

  // ─── GET /artworks/:id/history ────────────────────────────────────────────

  @Get(':id/history')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Lịch sử giao dịch của một artwork',
    description:
      'Query dùng composite index idx_tx_history(artwork_id, timestamp DESC). ' +
      'JOIN với users để lấy wallet_address trader.',
  })
  @ApiParam({ name: 'id', type: String })
  @ApiQuery({ name: 'page',  type: Number, required: false, example: 1 })
  @ApiQuery({ name: 'limit', type: Number, required: false, example: 20 })
  @ApiResponse({ status: 200, description: 'Lịch sử giao dịch có phân trang' })
  async getTradingHistory(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('page',  new DefaultValuePipe(1),  ParseIntPipe) page:  number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.artworksService.getArtworkTradingHistory(id, page, Math.min(limit, 100));
  }

  // ─── POST /artworks/:id/view ──────────────────────────────────────────────

  @Post(':id/view')
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Tăng view count (fire-and-forget)' })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({ status: 204, description: 'View count đã tăng' })
  async incrementView(@Param('id', ParseUUIDPipe) id: string) {
    await this.artworksService.incrementViewCount(id);
  }

  // ─── GET /artworks/:id/ohlcv ──────────────────────────────────────────────

  @Get(':id/ohlcv')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'OHLCV candles cho candlestick chart (TradingView)',
    description:
      'Đọc từ Materialized Views ClickHouse đã pre-compute — tốc độ micro-giây. ' +
      'KHÔNG query bảng trades trực tiếp.',
  })
  @ApiParam({ name: 'id', type: String })
  @ApiQuery({ name: 'interval', enum: ['1m', '5m', '1h'], required: false })
  @ApiQuery({ name: 'from',     type: String, required: false })
  @ApiQuery({ name: 'to',       type: String, required: false })
  @ApiQuery({ name: 'limit',    type: Number, required: false })
  @ApiResponse({ status: 200, description: 'Mảng OHLCV candles sorted ASC' })
  async getOhlcv(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('interval') interval: OhlcvInterval = '1h',
    @Query('from') from?: string,
    @Query('to')   to?: string,
    @Query('limit', new DefaultValuePipe(200), ParseIntPipe) limit?: number,
  ) {
    const fromDate = from ? new Date(from) : new Date(Date.now() - 7 * 24 * 3600 * 1000);
    const toDate   = to   ? new Date(to)   : new Date();
    return this.clickHouseService.getOhlcv(
      id,
      interval,
      fromDate,
      toDate,
      Math.min(limit ?? 200, 1000),
    );
  }

  private detectImageMime(buffer: Buffer): string | null {
    if (buffer.length < 12) return null;
    const b = buffer;
    if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'image/jpeg';
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return 'image/png';
    if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
    if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
        b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
    return null;
  }
}
