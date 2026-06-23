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

import { LiveService }     from './live.service';
import { CreateStreamDto } from './dto/create-stream.dto';
import { CurrentUser }     from '../../common/decorators';
import { Public }          from '../../common/decorators';
import { JwtPayload }      from '../auth/auth.service';

@ApiTags('live')
@ApiBearerAuth()
@Controller('live')
export class LiveController {

  constructor(private readonly liveService: LiveService) {}

  // ── POST /live/create ─────────────────────────────────────────────────────
  // Host gọi endpoint này để tạo room và nhận host token
  @Post('create')
  @Throttle({ default: { limit: 3, ttl: 3600000 } })
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

  // ── GET /live/:roomName ───────────────────────────────────────────────────
  // @Public() bắt buộc — LiveViewer.tsx fetch stream info không có JWT
  @Get(':roomName')
  @Public()
  @ApiOperation({ summary: 'Thông tin 1 stream (public)' })
  async getStream(@Param('roomName') roomName: string) {
    return this.liveService.getStream(roomName);
  }

  // ── GET /live/:roomName/viewer-token ──────────────────────────────────────
  // Viewer (authenticated hoặc anonymous) lấy token để xem stream
  @Get(':roomName/viewer-token')
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'Lấy viewer token cho stream' })
  @ApiQuery({ name: 'identity', required: false, description: 'wallet address hoặc anon id' })
  async getViewerToken(
    @Param('roomName') roomName: string,
    @Query('identity')  identity?: string,
  ) {
    const viewerId = (identity && identity.length <= 128)
      ? identity.replace(/[^a-zA-Z0-9_\-\.]/g, '')
      : `anon-${Date.now()}`;
    return this.liveService.getViewerToken(roomName, viewerId);
  }

  // ── DELETE /live/:roomName ────────────────────────────────────────────────
  // Host kết thúc stream của mình
  @Delete(':roomName')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Kết thúc stream (host only)' })
  async endStream(
    @Param('roomName') roomName: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.liveService.endStream(roomName, user.sub);
  }

  // ── POST /live/webhook ────────────────────────────────────────────────────
  // LiveKit Cloud gọi endpoint này khi participant join/leave để cập nhật viewer_count.
  // Phải đặt TRƯỚC /:roomName để không bị parse "webhook" làm roomName.
  // Xác thực bằng webhook signature key để tránh spoof.
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
}
