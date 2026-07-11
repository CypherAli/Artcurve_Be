import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
  Logger,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository }       from 'typeorm';
import { ConfigService }    from '@nestjs/config';
import {
  AccessToken,
  RoomServiceClient,
  WebhookReceiver,
  type CreateOptions,
} from 'livekit-server-sdk';

import { QueryFailedError } from 'typeorm';
import { LiveStream }      from './entities/live-stream.entity';
import { LiveChat }        from './entities/live-chat.entity';
import { LiveTip }         from './entities/live-tip.entity';
import { CreateStreamDto } from './dto/create-stream.dto';
import { RedisService }    from '../../shared/redis/redis.service';
import { EventsGateway }   from '../gateway/events.gateway';
import { randomUUID }      from 'crypto';

@Injectable()
export class LiveService {
  private readonly logger = new Logger(LiveService.name);

  constructor(
    @InjectRepository(LiveStream)
    private readonly liveRepo: Repository<LiveStream>,
    @InjectRepository(LiveChat)
    private readonly chatRepo: Repository<LiveChat>,
    @InjectRepository(LiveTip)
    private readonly tipRepo: Repository<LiveTip>,
    private readonly config:   ConfigService,
    private readonly redisService: RedisService,
    @Inject(forwardRef(() => EventsGateway))
    private readonly eventsGateway: EventsGateway,
  ) {}

  // ── helpers ──────────────────────────────────────────────────────────────

  private get apiKey()    { return this.config.get<string>('LIVEKIT_API_KEY',    ''); }
  private get apiSecret() { return this.config.get<string>('LIVEKIT_API_SECRET', ''); }
  private get serverUrl() { return this.config.get<string>('LIVEKIT_URL',        ''); }

  private roomService() {
    return new RoomServiceClient(this.serverUrl, this.apiKey, this.apiSecret);
  }

  /**
   * Kiểm tra room có THẬT SỰ còn tồn tại trên LiveKit Cloud không (nguồn sự thật
   * duy nhất — DB chỉ là cache). listParticipants ném lỗi nếu room không tồn tại
   * → coi là đã chết. Nếu LiveKit chưa cấu hình (serverUrl rỗng, dev offline),
   * coi như không xác minh được → giữ nguyên hành vi cũ (chặn) để an toàn.
   */
  private async isRoomActuallyLive(roomName: string): Promise<boolean> {
    if (!this.serverUrl) return true;
    try {
      await this.roomService().listParticipants(roomName);
      return true; // room tồn tại (có thể 0 người, nhưng chưa hẳn đã chết — để timeout tự nhiên xử lý)
    } catch {
      return false; // room không tồn tại trên LiveKit — chắc chắn đã chết
    }
  }

  /** Tạo JWT token cho một participant trong room */
  private async buildToken(
    roomName:   string,
    identity:   string,
    name:       string,
    canPublish: boolean,
  ): Promise<string> {
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
    // Kiểm tra host đã có stream đang live chưa.
    // Nếu có, xác minh THẬT trên LiveKit trước khi chặn — nếu user đóng tab/crash
    // browser thay vì bấm "End Stream", DB vẫn ghi is_live=true mãi mãi (webhook
    // dọn tự động không hoạt động ở local vì LiveKit Cloud không gọi được vào
    // localhost). Không xác minh thì user bị khóa vĩnh viễn không tạo được stream mới.
    const activeStream = await this.liveRepo.findOne({
      where: { host_id: hostId, is_live: true },
    });
    if (activeStream) {
      const stillLive = await this.isRoomActuallyLive(activeStream.room_name);
      if (stillLive) {
        throw new ConflictException('You already have an active stream');
      }
      // Phòng đã chết thật (0 người hoặc không còn tồn tại) — tự dọn rồi cho tạo mới
      this.logger.warn(`Auto-cleaning stale stream: ${activeStream.room_name}`);
      activeStream.is_live  = false;
      activeStream.ended_at = new Date();
      await this.liveRepo.save(activeStream);
    }

    // randomUUID đảm bảo không trùng room name kể cả khi cùng host start 2 stream cùng lúc
    const roomName = `stream-${hostId.slice(0, 8)}-${randomUUID()}`;

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
    try {
      await this.liveRepo.save(stream);
    } catch (err) {
      if (err instanceof QueryFailedError && (err as any).code === '23505') {
        throw new ConflictException('Duplicate stream room name');
      }
      throw err;
    }

    const token = await this.buildToken(roomName, hostId, hostName, true);

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

    const token = await this.buildToken(roomName, viewerId, viewerId, false);
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
    if (!stream) throw new NotFoundException('Stream không tồn tại hoặc bạn không phải host.');

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

  /** Cập nhật viewer_count trực tiếp */
  async updateViewerCount(roomName: string, count: number): Promise<void> {
    await this.liveRepo.update({ room_name: roomName }, { viewer_count: count });
  }

  /**
   * Xử lý webhook từ LiveKit Cloud.
   * LiveKit gửi event khi participant join/leave/disconnect.
   * Xác thực chữ ký để ngăn spoof từ nguồn bên ngoài.
   *
   * Event types quan trọng:
   *   participant_joined  → viewer_count + 1
   *   participant_left    → viewer_count - 1
   *   room_finished       → is_live = false, ended_at = now
   */
  async handleWebhook(
    body: Record<string, unknown>,
    signature: string,
    rawBody?: Buffer,
  ): Promise<{ ok: true }> {
    if (this.apiKey && this.apiSecret && rawBody) {
      try {
        const receiver = new WebhookReceiver(this.apiKey, this.apiSecret);
        await receiver.receive(rawBody.toString(), signature);
      } catch {
        // Signature mismatch — return early WITHOUT processing the event
        this.logger.warn('[LiveKit Webhook] Invalid signature — rejecting');
        return { ok: true };
      }
    } else {
      // No API key/secret or no rawBody — cannot verify, reject
      this.logger.warn('[LiveKit Webhook] Missing credentials or rawBody — rejecting');
      return { ok: true };
    }

    const event    = body['event'] as string | undefined;
    const roomName = (body['room'] as Record<string, unknown>)?.['name'] as string | undefined;

    if (!roomName) return { ok: true };

    const participantId = (body['participant'] as Record<string, unknown>)?.['identity'] as string | undefined;

    if (event === 'participant_joined' && participantId) {
      const setKey = `live:viewers:${roomName}`;
      await this.redisService.sadd(setKey, participantId);
      await this.redisService.expire(setKey, 86400);
      const count = await this.redisService.scard(setKey);
      await this.liveRepo.update(
        { room_name: roomName, is_live: true },
        { viewer_count: count },
      );
    } else if (event === 'participant_left' && participantId) {
      const setKey = `live:viewers:${roomName}`;
      await this.redisService.srem(setKey, participantId);
      const count = await this.redisService.scard(setKey);
      await this.liveRepo.update(
        { room_name: roomName, is_live: true },
        { viewer_count: count },
      );
    } else if (event === 'room_finished') {
      // Cleanup Redis viewer set
      await this.redisService.del(`live:viewers:${roomName}`);
      await this.liveRepo.update(
        { room_name: roomName },
        { is_live: false, ended_at: new Date() },
      );
      this.logger.log(`[LiveKit Webhook] Room finished: ${roomName}`);
    }

    return { ok: true };
  }

  // ── Live Chat ─────────────────────────────────────────────────────────────

  private async requireLiveStream(roomName: string): Promise<LiveStream> {
    const stream = await this.liveRepo.findOne({ where: { room_name: roomName, is_live: true } });
    if (!stream) throw new NotFoundException('Stream not found or has ended');
    return stream;
  }

  async postChatMessage(roomName: string, userId: string, userName: string, content: string) {
    await this.requireLiveStream(roomName);
    const sanitized = content.replace(/<[^>]*>/g, '').trim();
    if (!sanitized) throw new BadRequestException('Message cannot be empty');

    const msg = this.chatRepo.create({
      room_name: roomName,
      user_id: userId,
      user_name: userName,
      content: sanitized.slice(0, 300),
    });
    const saved = await this.chatRepo.save(msg);
    this.eventsGateway.broadcastLiveChat(roomName, saved);
    return saved;
  }

  async getChatMessages(roomName: string, limit = 50) {
    return this.chatRepo.find({
      where: { room_name: roomName },
      order: { created_at: 'DESC' },
      take: Math.min(limit, 100),
    });
  }

  // ── Tips ───────────────────────────────────────────────────────────────────

  async sendTip(roomName: string, fromUserId: string, fromUserName: string, amountEth: string, message?: string) {
    const stream = await this.requireLiveStream(roomName);

    const amount = Number(amountEth);
    if (isNaN(amount) || amount <= 0) {
      throw new BadRequestException('Tip amount must be positive');
    }

    const tip = this.tipRepo.create({
      room_name: roomName,
      from_user_id: fromUserId,
      from_user_name: fromUserName,
      to_host_id: stream.host_id,
      amount_eth: amountEth,
      message: message?.replace(/<[^>]*>/g, '').trim().slice(0, 200) || null,
    });
    const saved = await this.tipRepo.save(tip);
    this.eventsGateway.broadcastLiveTip(roomName, saved);
    return saved;
  }

  async getTips(roomName: string, limit = 20) {
    return this.tipRepo.find({
      where: { room_name: roomName },
      order: { created_at: 'DESC' },
      take: Math.min(limit, 100),
    });
  }

  async getTotalTips(roomName: string) {
    const result = await this.tipRepo
      .createQueryBuilder('t')
      .select('COALESCE(SUM(CAST(t.amount_eth AS DECIMAL(38,18))), 0)', 'total')
      .addSelect('COUNT(t.id)', 'count')
      .where('t.room_name = :roomName', { roomName })
      .getRawOne();
    return { total_eth: Number(result?.total ?? 0), tip_count: Number(result?.count ?? 0) };
  }
}
