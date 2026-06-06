import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository }       from 'typeorm';
import { ConfigService }    from '@nestjs/config';
import {
  AccessToken,
  RoomServiceClient,
  type CreateOptions,
} from 'livekit-server-sdk';

import { LiveStream }      from './entities/live-stream.entity';
import { CreateStreamDto } from './dto/create-stream.dto';

@Injectable()
export class LiveService {
  private readonly logger = new Logger(LiveService.name);

  constructor(
    @InjectRepository(LiveStream)
    private readonly liveRepo: Repository<LiveStream>,
    private readonly config:   ConfigService,
  ) {}

  // ── helpers ──────────────────────────────────────────────────────────────

  private get apiKey()    { return this.config.get<string>('LIVEKIT_API_KEY',    ''); }
  private get apiSecret() { return this.config.get<string>('LIVEKIT_API_SECRET', ''); }
  private get serverUrl() { return this.config.get<string>('LIVEKIT_URL',        ''); }

  private roomService() {
    return new RoomServiceClient(this.serverUrl, this.apiKey, this.apiSecret);
  }

  /** Tạo JWT token cho một participant trong room */
  private buildToken(
    roomName:   string,
    identity:   string,
    name:       string,
    canPublish: boolean,
  ): string {
    const at = new AccessToken(this.apiKey, this.apiSecret, { identity, name });
    at.addGrant({
      roomJoin:       true,
      room:           roomName,
      canPublish,
      canSubscribe:   true,
      canPublishData: canPublish,
    });
    // Token valid 6 hours
    at.ttl = '6h';
    return at.toJwt();
  }

  // ── public API ────────────────────────────────────────────────────────────

  /**
   * Tạo room LiveKit mới + lưu DB + trả host token.
   * Được gọi từ GoLiveModal (FE).
   */
  async createStream(
    hostId:   string,
    hostName: string,
    dto:      CreateStreamDto,
  ) {
    const roomName = `stream-${hostId.slice(0, 8)}-${Date.now()}`;

    // Tạo room trên LiveKit Cloud
    if (this.serverUrl) {
      try {
        const svc = this.roomService();
        const opts: CreateOptions = {
          name:            roomName,
          emptyTimeout:    120,   // tự xoá sau 2 phút không có ai
          maxParticipants: 2000,
          metadata: JSON.stringify({ title: dto.title, category: dto.category }),
        };
        await svc.createRoom(opts);
        this.logger.log(`LiveKit room created: ${roomName}`);
      } catch (err) {
        this.logger.warn(`LiveKit room creation failed (offline mode): ${(err as Error).message}`);
        // Tiếp tục chạy — dev có thể không có LiveKit
      }
    }

    // Lưu vào PostgreSQL
    const stream = this.liveRepo.create({
      room_name:     roomName,
      title:         dto.title,
      category:      dto.category,
      host_id:       hostId,
      host_name:     hostName,
      artwork_ticker: dto.artwork_ticker ?? null,
    });
    await this.liveRepo.save(stream);

    const token = this.buildToken(roomName, hostId, hostName, true);

    return {
      roomName,
      token,
      liveKitUrl:  this.serverUrl,
      streamId:    stream.id,
    };
  }

  /**
   * Tạo viewer token cho một room đang live.
   * identity = wallet address hoặc 'anon-<random>'
   */
  async getViewerToken(roomName: string, viewerId: string) {
    const stream = await this.liveRepo.findOne({
      where: { room_name: roomName, is_live: true },
    });
    if (!stream) throw new NotFoundException('Stream không tồn tại hoặc đã kết thúc.');

    const token = this.buildToken(roomName, viewerId, viewerId, false);
    return { token, liveKitUrl: this.serverUrl, stream };
  }

  /** Danh sách stream đang live, sắp xếp theo viewer_count desc */
  async listLive() {
    return this.liveRepo.find({
      where:  { is_live: true },
      order:  { viewer_count: 'DESC', started_at: 'DESC' },
    });
  }

  /** Lấy thông tin 1 stream */
  async getStream(roomName: string) {
    const s = await this.liveRepo.findOne({ where: { room_name: roomName } });
    if (!s) throw new NotFoundException('Stream not found');
    return s;
  }

  /** Kết thúc stream — chỉ host mới được gọi */
  async endStream(roomName: string, hostId: string) {
    const stream = await this.liveRepo.findOne({
      where: { room_name: roomName, host_id: hostId, is_live: true },
    });
    if (!stream) throw new NotFoundException('Stream không tồn tại.');
    if (stream.host_id !== hostId) throw new ForbiddenException('Chỉ host mới được kết thúc stream.');

    stream.is_live  = false;
    stream.ended_at = new Date();
    await this.liveRepo.save(stream);

    // Xoá room khỏi LiveKit
    if (this.serverUrl) {
      try {
        await this.roomService().deleteRoom(roomName);
      } catch (err) {
        this.logger.warn(`LiveKit deleteRoom failed: ${(err as Error).message}`);
      }
    }

    return { ended: true };
  }

  /** Webhook từ LiveKit: cập nhật viewer_count */
  async updateViewerCount(roomName: string, count: number) {
    await this.liveRepo.update({ room_name: roomName }, { viewer_count: count });
  }
}
