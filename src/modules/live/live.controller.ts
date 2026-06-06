import {
  Controller, Post, Get, Delete,
  Param, Body, Query,
  HttpCode, HttpStatus,
} from '@nestjs/common';
import {
  ApiTags, ApiOperation, ApiBearerAuth, ApiBody, ApiQuery,
} from '@nestjs/swagger';

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
  @Get(':roomName')
  @Public()
  @ApiOperation({ summary: 'Thông tin 1 stream' })
  async getStream(@Param('roomName') roomName: string) {
    return this.liveService.getStream(roomName);
  }

  // ── GET /live/:roomName/viewer-token ──────────────────────────────────────
  // Viewer (authenticated hoặc anonymous) lấy token để xem stream
  @Get(':roomName/viewer-token')
  @Public()
  @ApiOperation({ summary: 'Lấy viewer token cho stream' })
  @ApiQuery({ name: 'identity', required: false, description: 'wallet address hoặc anon id' })
  async getViewerToken(
    @Param('roomName') roomName: string,
    @Query('identity')  identity?: string,
  ) {
    const viewerId = identity ?? `anon-${Date.now()}`;
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
}
