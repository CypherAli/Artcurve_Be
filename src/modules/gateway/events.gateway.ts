import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import {
  UseGuards,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { Web3AuthGuard } from '../../common/guards/web3-auth.guard';
import { RedisService } from '../../shared/redis/redis.service';
import type { JwtPayload } from '../auth/auth.service';

// ─────────────────────────────────────────────────────────────────────────────
//  EventsGateway  (src/modules/gateway/events.gateway.ts)
//
//  Unified WebSocket Gateway cho toàn bộ real-time events:
//
//  ┌─────────────────────────────────────────────────────────┐
//  │  LUỒNG DỮ LIỆU                                          │
//  │                                                         │
//  │  Blockchain Event                                       │
//  │    → RabbitMQ (artcurve.blockchain exchange)            │
//  │      → BlockchainEventConsumer (ghi PG + Redis + CH)    │
//  │        → Redis PUBLISH 'artwork:price:updated'          │
//  │          → EventsGateway (subscriber)                   │
//  │            → emit 'trade_updated' → room artwork:{id}   │
//  │              → Frontend cập nhật chart real-time        │
//  └─────────────────────────────────────────────────────────┘
//
//  Authentication:
//    - Bọc bằng Web3AuthGuard — JWT bắt buộc khi connect
//    - Client phải gửi: socket = io(url, { auth: { token: 'eyJ...' } })
//    - Sau khi verify: socket.data.user = JwtPayload
//
//  Events Server → Client:
//    'trade_updated'      — mỗi giao dịch mua/bán mới
//    'price_snapshot'     — giá hiện tại ngay khi subscribe
//    'artwork_graduated'  — artwork đạt targetCap, graduate lên DEX
//    'auth_error'         — token không hợp lệ (trước khi disconnect)
//
//  Events Client → Server:
//    'subscribe_artwork'   { artwork_id } — join room artwork:{id}
//    'unsubscribe_artwork' { artwork_id } — leave room
//
//  Phân biệt với price.gateway.ts (cũ):
//    - price.gateway.ts: namespace /prices, không auth
//    - events.gateway.ts: namespace /events, JWT bắt buộc, RabbitMQ pattern
// ─────────────────────────────────────────────────────────────────────────────

// ── Payload types ─────────────────────────────────────────────────────────────

export interface TradeUpdatedEvent {
  artwork_id:      string;
  tx_hash:         string;
  is_buy:          boolean;
  user_wallet:     string;
  share_amount:    string;
  eth_amount:      string;
  price_per_share: string;
  block_number:    string;
  timestamp:       number;   // unix ms
}

export interface PriceSnapshotEvent {
  artwork_id:      string;
  current_price:   string;
  current_supply:  string;
  volume_24h:      string;
  updated_at:      string;
}

// ── Gateway ───────────────────────────────────────────────────────────────────

const EVENTS_CORS_ORIGINS = [
  process.env.FRONTEND_URL ?? 'https://artcurve-fe.vercel.app',
  ...(process.env.NODE_ENV !== 'production'
    ? ['http://localhost:3000', 'http://localhost:3001']
    : []),
].filter(Boolean);

@UseGuards(Web3AuthGuard)
@WebSocketGateway({
  namespace:    '/events',
  cors: {
    origin:      EVENTS_CORS_ORIGINS,
    credentials: true,
  },
  pingInterval: 25_000,
  pingTimeout:  10_000,
})
export class EventsGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect,
             OnModuleInit, OnModuleDestroy
{
  @WebSocketServer()
  private server: Server;

  private readonly logger = new Logger(EventsGateway.name);

  constructor(private readonly redisService: RedisService) {}

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  afterInit(server: Server): void {
    this.logger.log('EventsGateway /events initialized');
  }

  /**
   * onModuleInit: Đăng ký lắng nghe Redis Pub/Sub.
   *
   * Mỗi lần BlockchainEventConsumer ghi thành công vào PG + Redis,
   * nó publish lên channel 'artwork:price:updated'.
   * Gateway nhận và broadcast 'trade_updated' đến đúng room.
   *
   * TODO (khi tích hợp RabbitMQ trực tiếp):
   *   Thay Redis Pub/Sub bằng amqp-connection-manager consumer ở đây.
   *   Lắng nghe exchange artcurve.blockchain → routing key blockchain.trade.executed
   *   → emit 'trade_updated' trực tiếp mà không qua Redis relay.
   *   Cách này giảm latency ~2ms nhưng cần xử lý reconnect amqp cẩn thận.
   */
  async onModuleInit(): Promise<void> {
    // Đăng ký nhận price updates qua Redis Pub/Sub.
    // RedisService dùng Set<callback> nên gọi nhiều lần từ nhiều gateway không tạo duplicate.
    // EventsGateway broadcast trade_updated đến /events namespace (JWT clients).
    // PriceGateway broadcast price_update đến /prices namespace (public).
    this.redisService.subscribePriceUpdates((event) => {
      this.broadcastTradeUpdated({
        artwork_id:      event.artwork_id,
        tx_hash:         event.tx_hash,
        is_buy:          event.is_buy ?? true,
        user_wallet:     event.user_wallet ?? '',
        share_amount:    event.share_amount ?? '0',
        eth_amount:      event.volume_24h,
        price_per_share: event.current_price,
        block_number:    '0',
        timestamp:       event.timestamp,
      });
    }).then(() => {
      this.logger.log('[EventsGateway] Subscribed to Redis artwork:price:updated');
    }).catch((e) => {
      this.logger.warn(`[EventsGateway] Redis subscribe skipped: ${(e as Error).message}`);
    });
  }

  onModuleDestroy(): void {
    // RedisService.unsubscribe() nếu cần cleanup
    this.logger.log('[EventsGateway] Destroyed');
  }

  handleConnection(client: Socket): void {
    const user = client.data?.user as JwtPayload | undefined;
    if (user) {
      client.join(`user:${user.sub}`);
      this.logger.debug(`WS connected: socketId=${client.id} wallet=${user.wallet}`);
    }
  }

  handleDisconnect(client: Socket): void {
    this.logger.debug(`WS disconnected: socketId=${client.id}`);
  }

  // ── Client → Server ────────────────────────────────────────────────────────

  /**
   * Client đăng ký nhận events cho 1 artwork cụ thể.
   *
   * Client gửi:
   *   socket.emit('subscribe_artwork', { artwork_id: 'uuid' })
   *
   * Server:
   *   1. Client join room 'artwork:{id}'
   *   2. Gửi ngay price snapshot hiện tại (không phải chờ trade mới)
   */
  @SubscribeMessage('subscribe_artwork')
  async handleSubscribe(
    @MessageBody()    data:   { artwork_id: string },
    @ConnectedSocket() client: Socket,
  ): Promise<void> {
    if (!data?.artwork_id) return;

    const room = `artwork:${data.artwork_id}`;
    await client.join(room);

    // Gửi snapshot ngay lập tức từ Redis cache
    const cached = await this.redisService.getArtworkPrice(data.artwork_id);
    if (cached) {
      const snapshot: PriceSnapshotEvent = {
        artwork_id:     data.artwork_id,
        current_price:  cached.current_price,
        current_supply: cached.current_supply,
        volume_24h:     cached.volume_24h,
        updated_at:     cached.updated_at,
      };
      client.emit('price_snapshot', snapshot);
    }

    this.logger.debug(`[WS] ${client.id} (${client.data.user?.wallet}) → joined ${room}`);
  }

  /**
   * Client hủy đăng ký.
   *   socket.emit('unsubscribe_artwork', { artwork_id: 'uuid' })
   */
  @SubscribeMessage('unsubscribe_artwork')
  async handleUnsubscribe(
    @MessageBody()    data:   { artwork_id: string },
    @ConnectedSocket() client: Socket,
  ): Promise<void> {
    if (!data?.artwork_id) return;
    const room = `artwork:${data.artwork_id}`;
    await client.leave(room);
    this.logger.debug(`[WS] ${client.id} → left ${room}`);
  }

  // ── Server → Client (broadcast) ───────────────────────────────────────────

  /**
   * Broadcast 'trade_updated' đến tất cả client đang subscribe artwork đó.
   *
   * Frontend lắng nghe:
   *   socket.on('trade_updated', (event: TradeUpdatedEvent) => {
   *     updateCandlestickChart(event);
   *     flashPriceTicker(event.price_per_share, event.is_buy);
   *     updateOrderbook(event);
   *   });
   *
   * Được gọi bởi:
   *   1. Redis Pub/Sub subscriber (onModuleInit) — hiện tại
   *   2. RabbitMQ consumer trực tiếp (TODO — tương lai)
   */
  broadcastTradeUpdated(event: TradeUpdatedEvent): void {
    const room = `artwork:${event.artwork_id}`;
    this.server.to(room).emit('trade_updated', event);
    this.logger.debug(
      `[WS] Broadcast trade_updated → room=${room} price=${event.price_per_share}`,
    );
  }

  /**
   * Broadcast 'artwork_graduated' — artwork đã graduate lên DEX.
   *
   * Frontend lắng nghe:
   *   socket.on('artwork_graduated', ({ artwork_id }) => {
   *     showGraduationBanner(artwork_id);
   *     redirectToDex(artwork_id);
   *   });
   */
  broadcastGraduated(artworkId: string): void {
    this.server
      .to(`artwork:${artworkId}`)
      .emit('artwork_graduated', { artwork_id: artworkId, timestamp: Date.now() });

    this.logger.log(`[WS] Broadcast artwork_graduated: artworkId=${artworkId}`);
  }

  /**
   * Push notification to a specific user via WebSocket.
   * User auto-joins room `user:{userId}` on connect.
   */
  pushNotification(userId: string, notification: {
    id: string; type: string; title: string; message: string; created_at: string;
  }): void {
    this.server.to(`user:${userId}`).emit('notification', notification);
    this.logger.debug(`[WS] Push notification → user:${userId} type=${notification.type}`);
  }
}
