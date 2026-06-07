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
import { Logger, OnModuleInit } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { RedisService, PriceUpdatedEvent } from '../../shared/redis/redis.service';

/**
 * PriceGateway — Real-time gia Bonding Curve
 *
 * Luong du lieu:
 *   Blockchain Event
 *     -> RabbitMQ Consumer
 *       -> Redis PUBLISH 'artwork:price:updated'
 *         -> PriceGateway (subscriber) nhan tin
 *           -> emit toi room 'artwork:{id}' tren Socket.IO
 *             -> Frontend nhan, cap nhat bieu do khong can reload
 *
 * Client flow:
 *   socket.emit('subscribe_artwork', { artwork_id: 'uuid' })
 *   socket.on('price_update', (data) => updateChart(data))
 *   socket.emit('unsubscribe_artwork', { artwork_id: 'uuid' })
 */
// Tách ra ngoài decorator để TypeScript không phàn nàn về expression in decorator
const PRICES_CORS_ORIGINS = [
  process.env.FRONTEND_URL ?? 'https://artcurve-fe.vercel.app',
  'http://localhost:3000',
  'http://localhost:3001',
].filter(Boolean);

@WebSocketGateway({
  namespace:   '/prices',
  cors: {
    origin:      PRICES_CORS_ORIGINS,
    credentials: true,
  },
})
export class PriceGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, OnModuleInit
{
  @WebSocketServer()
  private server: Server;

  private readonly logger = new Logger(PriceGateway.name);

  constructor(private readonly redisService: RedisService) {}

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  afterInit() {
    this.logger.log('WebSocket Gateway /prices initialized');
  }

  handleConnection(client: Socket) {
    this.logger.debug(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.debug(`Client disconnected: ${client.id}`);
  }

  /**
   * onModuleInit: đăng ký hai Redis channels ngay khi gateway khởi động.
   *   - artwork:price:updated  → broadcastPriceUpdate (trade xảy ra)
   *   - artwork:graduated      → broadcastGraduated   (đạt target cap)
   *
   * Non-blocking: Redis có thể chưa sẵn sàng trong dev environment.
   */
  async onModuleInit(): Promise<void> {
    Promise.all([
      this.redisService.subscribePriceUpdates(
        (event: PriceUpdatedEvent) => this.broadcastPriceUpdate(event),
      ),
      this.redisService.subscribeArtworkGraduated(
        (artworkId: string) => this.broadcastGraduated(artworkId),
      ),
    ]).then(() => {
      this.logger.log('Subscribed to Redis price and graduation channels');
    }).catch((e) => {
      this.logger.warn(`Redis subscribe skipped: ${(e as Error).message}`);
    });
  }

  // ── Event Handlers (Client -> Server) ─────────────────────────────────────

  /**
   * Client muon theo doi gia 1 artwork cu the:
   * socket.emit('subscribe_artwork', { artwork_id: 'uuid' })
   * -> tham gia room 'artwork:{id}'
   */
  @SubscribeMessage('subscribe_artwork')
  async handleSubscribe(
    @MessageBody() data: { artwork_id: string },
    @ConnectedSocket() client: Socket,
  ): Promise<void> {
    const room = `artwork:${data.artwork_id}`;
    await client.join(room);

    // Gui gia hien tai ngay lap tuc (khong phai cho trade moi)
    const cachedPrice = await this.redisService.getArtworkPrice(data.artwork_id);
    if (cachedPrice) {
      client.emit('price_snapshot', {
        artwork_id: data.artwork_id,
        ...cachedPrice,
      });
    }

    this.logger.debug(`${client.id} subscribed to ${room}`);
  }

  /**
   * Client huy theo doi:
   * socket.emit('unsubscribe_artwork', { artwork_id: 'uuid' })
   */
  @SubscribeMessage('unsubscribe_artwork')
  async handleUnsubscribe(
    @MessageBody() data: { artwork_id: string },
    @ConnectedSocket() client: Socket,
  ): Promise<void> {
    const room = `artwork:${data.artwork_id}`;
    await client.leave(room);
    this.logger.debug(`${client.id} left ${room}`);
  }

  // ── Broadcast (Server -> Clients) ─────────────────────────────────────────

  /**
   * Goi boi Redis subscriber khi nhan duoc 'artwork:price:updated'.
   * Day event toi tat ca client trong room tuong ung.
   *
   * Frontend lang nghe:
   *   socket.on('price_update', ({ artwork_id, current_price, ... }) => {
   *     updateCandlestickChart(data);
   *     flashPriceGreenOrRed(data);
   *   })
   */
  private broadcastPriceUpdate(event: PriceUpdatedEvent): void {
    const room = `artwork:${event.artwork_id}`;
    this.server.to(room).emit('price_update', event);
    this.logger.debug(
      `Broadcast price=${event.current_price} -> room=${room}`,
    );
  }

  /**
   * [Public method] RabbitMQ Consumer co the goi truc tiep de
   * broadcast artwork graduated (dat target_cap, lên Uniswap)
   */
  broadcastGraduated(artworkId: string): void {
    this.server
      .to(`artwork:${artworkId}`)
      .emit('artwork_graduated', { artwork_id: artworkId, timestamp: Date.now() });
  }
}
