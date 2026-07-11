import {
  Controller, Post, Get, Delete,
  Param, Body, Query, Headers, RawBodyRequest, Req,
  HttpCode, HttpStatus,
} from '@nestjs/common';
import { Request } from 'express';
import {
  ApiTags, ApiOperation, ApiBearerAuth, ApiBody, ApiQuery,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { LiveService }       from './live.service';
import { CreateStreamDto }   from './dto/create-stream.dto';
import { CreateLiveChatDto } from './dto/live-chat.dto';
import { CreateLiveTipDto }  from './dto/live-tip.dto';
import { CurrentUser }       from '../../common/decorators';
import { Public }            from '../../common/decorators';
import { JwtPayload }      from '../auth/auth.service';

@ApiTags('live')
@ApiBearerAuth()
@Controller('live')
export class LiveController {

  constructor(private readonly liveService: LiveService) {}

  // ── POST /live/create ─────────────────────────────────────────────────────
  // Host gọi endpoint này để tạo room và nhận host token
  // 10/giờ — đủ thoải mái để tạo/chỉnh sửa/thử lại stream (kể cả sau lỗi mạng),
  // vẫn chặn được spam thật (tạo room hàng loạt để phá LiveKit resource).
  @Post('create')
  @Throttle({ default: { limit: 10, ttl: 3600000 } })
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Tạo stream mới (host)' })
  async createStream(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateStreamDto,
  ) {
    const hostName = user.wallet?.slice(0, 8) ?? 'Artist';
    return this.liveService.createStream(user.sub, hostName, dto);
  }

  // ── GET /live ─────────────────────────────────────────────────────────────
  @Get()
  @Public()
  @ApiOperation({ summary: 'Danh sách streams đang live' })
  async listLive() {
    return this.liveService.listLive();
  }

  // ── POST /live/webhook (MUST be before :roomName routes) ──────────────────
  @Post('webhook')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'LiveKit Cloud webhook — cập nhật viewer count (internal)' })
  async handleLiveKitWebhook(
    @Body() body: Record<string, unknown>,
    @Headers('webhook-signature') signature: string,
    @Req() req: RawBodyRequest<Request>,
  ) {
    return this.liveService.handleWebhook(body, signature, req.rawBody);
  }

  // ── GET /live/:roomName ───────────────────────────────────────────────────
  @Get(':roomName')
  @Public()
  @ApiOperation({ summary: 'Thông tin 1 stream (public)' })
  async getStream(@Param('roomName') roomName: string) {
    return this.liveService.getStream(roomName);
  }

  // ── POST /live/:roomName/viewer-token ─────────────────────────────────────
  @Post(':roomName/viewer-token')
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'Lấy viewer token cho stream' })
  async getViewerToken(
    @Param('roomName') roomName: string,
    @Body('identity')  identity?: string,
  ) {
    const viewerId = (identity && identity.length <= 128)
      ? identity.replace(/[^a-zA-Z0-9_\-\.]/g, '')
      : `anon-${Date.now()}`;
    return this.liveService.getViewerToken(roomName, viewerId);
  }

  // ── DELETE /live/:roomName ────────────────────────────────────────────────
  @Delete(':roomName')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Kết thúc stream (host only)' })
  async endStream(
    @Param('roomName') roomName: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.liveService.endStream(roomName, user.sub);
  }

  // ── Live Chat ─────────────────────────────────────────────────────────────

  @Post(':roomName/chat')
  @ApiBearerAuth()
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @ApiOperation({ summary: 'Post chat message to live stream' })
  async postChat(
    @Param('roomName') roomName: string,
    @Body() dto: CreateLiveChatDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const userName = user.wallet?.slice(0, 8) ?? 'Anon';
    return this.liveService.postChatMessage(roomName, user.sub, userName, dto.content);
  }

  @Get(':roomName/chat')
  @Public()
  @ApiOperation({ summary: 'Get recent chat messages for stream' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async getChat(
    @Param('roomName') roomName: string,
    @Query('limit') limit?: number,
  ) {
    return this.liveService.getChatMessages(roomName, limit ? +limit : 50);
  }

  // ── Tips ───────────────────────────────────────────────────────────────────

  @Post(':roomName/tip')
  @ApiBearerAuth()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'Send tip to stream host' })
  async sendTip(
    @Param('roomName') roomName: string,
    @Body() dto: CreateLiveTipDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const userName = user.wallet?.slice(0, 8) ?? 'Anon';
    return this.liveService.sendTip(roomName, user.sub, userName, dto.amount_eth, dto.message);
  }

  @Get(':roomName/tips')
  @Public()
  @ApiOperation({ summary: 'Get tips for a stream' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async getTips(
    @Param('roomName') roomName: string,
    @Query('limit') limit?: number,
  ) {
    return this.liveService.getTips(roomName, limit ? +limit : 20);
  }

  @Get(':roomName/tips/total')
  @Public()
  @ApiOperation({ summary: 'Get total tips for a stream' })
  async getTotalTips(@Param('roomName') roomName: string) {
    return this.liveService.getTotalTips(roomName);
  }
}
