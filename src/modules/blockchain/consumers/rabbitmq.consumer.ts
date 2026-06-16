import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as amqp from 'amqplib';
import { BlockchainEventConsumer } from './event.consumer';
import { captureException } from '../../../common/observability/sentry.util';

// ─────────────────────────────────────────────────────────────────────────────
//  RabbitMQ Consumer — đồng bộ với ProducerService
//
//  Exchange: artcurve.blockchain (topic, durable)
//
//  Routing keys & queues (khớp với producer.service.ts):
//    blockchain.artwork.created  → artcurve.artwork.created
//    blockchain.trade.executed   → artcurve.trade.executed   (is_buy phân nhánh)
//    blockchain.graduated        → artcurve.tx.graduated
//
//  Thiết kế:
//    - prefetch(1): xử lý tuần tự, tránh race condition khi update balance
//    - DLQ: message lỗi đẩy vào artcurve.blockchain.dlx
//    - Reconnect: tự động sau 5s khi mất kết nối
// ─────────────────────────────────────────────────────────────────────────────

const EXCHANGE = 'artcurve.blockchain';
const DLX      = `${EXCHANGE}.dlx`;
const DLQ      = `${EXCHANGE}.dlq`;   // queue gom message chết để quan sát/alert

// Khớp chính xác với env.validation.ts defaults và producer.service.ts
const QUEUES = {
  ARTWORK_CREATED: 'artcurve.artwork.created',
  TRADE_EXECUTED:  'artcurve.trade.executed',
  GRADUATED:       'artcurve.tx.graduated',
} as const;

const ROUTING_KEYS = {
  ARTWORK_CREATED: 'blockchain.artwork.created',
  TRADE_EXECUTED:  'blockchain.trade.executed',
  GRADUATED:       'blockchain.graduated',
} as const;

@Injectable()
export class RabbitMQBlockchainConsumer implements OnModuleInit {
  private readonly logger = new Logger(RabbitMQBlockchainConsumer.name);
  private connection: amqp.ChannelModel;
  private channel: amqp.Channel;

  constructor(
    private readonly config:        ConfigService,
    private readonly eventConsumer: BlockchainEventConsumer,
  ) {}

  async onModuleInit(): Promise<void> {
    // Non-blocking: RabbitMQ có thể không có trong dev
    this.connect();
  }

  private async connect(): Promise<void> {
    const url = this.config.get<string>('RABBITMQ_URL', 'amqp://localhost:5672');

    try {
      this.connection = await amqp.connect(url) as amqp.ChannelModel;
      this.channel    = await this.connection.createChannel();

      // Dead Letter Exchange cho tất cả queues
      await this.channel.assertExchange(EXCHANGE, 'topic', { durable: true });
      await this.channel.assertExchange(DLX,      'topic', { durable: true });

      await this.setupQueue(QUEUES.ARTWORK_CREATED, ROUTING_KEYS.ARTWORK_CREATED);
      await this.setupQueue(QUEUES.TRADE_EXECUTED,  ROUTING_KEYS.TRADE_EXECUTED);
      await this.setupQueue(QUEUES.GRADUATED,       ROUTING_KEYS.GRADUATED);

      // DLQ: bind toàn bộ message chết từ DLX để quan sát (trước đây DLX không có
      // queue → message chết bị mất, không ai biết).
      await this.channel.assertQueue(DLQ, { durable: true });
      await this.channel.bindQueue(DLQ, DLX, '#');

      await this.startConsumers();
      await this.startDlqConsumer();

      this.connection.on('error', (err) => {
        this.logger.error(`RabbitMQ connection error: ${err.message}`);
        setTimeout(() => this.connect(), 5000);
      });

      this.logger.log(`[RabbitMQ] Consumer connected. Queues: ${Object.values(QUEUES).join(', ')}`);

    } catch (err) {
      this.logger.error(`[RabbitMQ] Connect failed: ${err.message}`);
      setTimeout(() => this.connect(), 5000);
    }
  }

  private async setupQueue(queue: string, routingKey: string): Promise<void> {
    await this.channel.assertQueue(queue, {
      durable: true,
      arguments: {
        'x-dead-letter-exchange': DLX,
        'x-message-ttl':          86_400_000, // 24h TTL
      },
    });
    await this.channel.bindQueue(queue, EXCHANGE, routingKey);
  }

  private async startConsumers(): Promise<void> {
    // prefetch(1): xử lý tuần tự để tránh race condition khi update balance
    this.channel.prefetch(1);

    // ── ArtworkCreated ──────────────────────────────────────────────────────
    // Payload: ArtworkCreatedPayload { amm_address, creator, artwork_id (onchain), ... }
    // Action: map creator wallet → DB user_id, set amm_address + onchain_id trên artwork
    await this.channel.consume(QUEUES.ARTWORK_CREATED, async (msg) => {
      if (!msg) return;
      await this.processMessage(msg, (payload) =>
        this.eventConsumer.handleArtworkCreated(payload),
      );
    });

    // ── TradeExecuted (BUY & SELL trong cùng 1 queue) ───────────────────────
    // Payload: TradeExecutedPayload { is_buy, amm_address, user_wallet, ... }
    // Action: phân nhánh theo is_buy → handleBuyShares / handleSellShares
    await this.channel.consume(QUEUES.TRADE_EXECUTED, async (msg) => {
      if (!msg) return;
      await this.processMessage(msg, async (payload) => {
        if (payload.is_buy) {
          await this.eventConsumer.handleBuyShares(payload);
        } else {
          await this.eventConsumer.handleSellShares(payload);
        }
      });
    });

    // ── GraduatedToDEX ─────────────────────────────────────────────────────
    await this.channel.consume(QUEUES.GRADUATED, async (msg) => {
      if (!msg) return;
      await this.processMessage(msg, (payload) =>
        this.eventConsumer.handleArtworkGraduated(payload),
      );
    });
  }

  /**
   * Consumer cho DLQ — message đã fail hết retry. Không xử lý lại (tránh loop),
   * chỉ LOG + gửi Sentry để alert + ack (xoá khỏi queue, tránh phình bộ nhớ).
   * Đây là điểm quan sát poison message ở production.
   */
  private async startDlqConsumer(): Promise<void> {
    await this.channel.consume(DLQ, (msg) => {
      if (!msg) return;
      const routingKey = msg.fields.routingKey;
      const body = msg.content.toString().slice(0, 2000); // cắt tránh log khổng lồ
      this.logger.error(`[DLQ] Dead-lettered message routingKey=${routingKey} body=${body}`);
      captureException(new Error(`Blockchain DLQ message: ${routingKey}`), {
        routing_key: routingKey,
        body,
        source: 'rabbitmq.dlq',
      });
      this.channel.ack(msg);
    });
    this.logger.log(`[RabbitMQ] DLQ consumer active on ${DLQ}`);
  }

  private async processMessage(
    msg: amqp.Message,
    handler: (payload: any) => Promise<void>,
  ): Promise<void> {
    let payload: any;
    try {
      payload = JSON.parse(msg.content.toString());
    } catch {
      this.logger.error('[RabbitMQ] Invalid JSON — sending to DLQ');
      this.channel.nack(msg, false, false);
      return;
    }

    try {
      await handler(payload);
      this.channel.ack(msg);
    } catch (err) {
      this.logger.error(`[RabbitMQ] Handler failed: ${err.message}`, {
        routing_key: msg.fields.routingKey,
        payload,
        stack: err.stack,
      });
      // requeue=false → DLQ sau khi vượt MAX_RETRY (configure ở RabbitMQ policy)
      this.channel.nack(msg, false, false);
    }
  }
}
