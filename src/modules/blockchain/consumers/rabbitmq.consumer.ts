import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as amqp from 'amqplib';
import { BlockchainEventConsumer } from './event.consumer';

// ─── RabbitMQ Queue & Routing Keys ───────────────────────────────────────────
const EXCHANGE = 'artcurve.blockchain';
const QUEUES = {
  BUY_SHARES: 'artcurve.tx.buy_shares',
  SELL_SHARES: 'artcurve.tx.sell_shares',
  GRADUATED: 'artcurve.tx.graduated',
  AI_MODERATION: 'artcurve.moderation.result',
} as const;

const ROUTING_KEYS = {
  BUY_SHARES: 'blockchain.buy_shares',
  SELL_SHARES: 'blockchain.sell_shares',
  GRADUATED: 'blockchain.graduated',
  AI_MODERATION: 'moderation.result',
} as const;

@Injectable()
export class RabbitMQBlockchainConsumer implements OnModuleInit {
  private readonly logger = new Logger(RabbitMQBlockchainConsumer.name);
  private connection: amqp.ChannelModel;
  private channel: amqp.Channel;

  constructor(
    private readonly config: ConfigService,
    private readonly eventConsumer: BlockchainEventConsumer,
  ) {}

  async onModuleInit(): Promise<void> {
    // Non-blocking: do not await — RabbitMQ may be unavailable in dev
    this.connect();
  }

  private async connect(): Promise<void> {
    const url = this.config.get<string>('RABBITMQ_URL', 'amqp://localhost:5672');

    try {
      this.connection = await amqp.connect(url) as amqp.ChannelModel;
      this.channel = await this.connection.createChannel();

      // Setup exchange + queues với durable = true để không mất message khi restart
      await this.channel.assertExchange(EXCHANGE, 'topic', { durable: true });

      await this.setupQueue(QUEUES.BUY_SHARES, ROUTING_KEYS.BUY_SHARES);
      await this.setupQueue(QUEUES.SELL_SHARES, ROUTING_KEYS.SELL_SHARES);
      await this.setupQueue(QUEUES.GRADUATED, ROUTING_KEYS.GRADUATED);
      await this.setupQueue(QUEUES.AI_MODERATION, ROUTING_KEYS.AI_MODERATION);

      await this.startConsumers();

      this.connection.on('error', (err) => {
        this.logger.error('RabbitMQ connection error', err.message);
        setTimeout(() => this.connect(), 5000); // Reconnect sau 5s
      });

      this.logger.log('RabbitMQ consumer connected');
    } catch (err) {
      this.logger.error(`RabbitMQ connect failed: ${err.message}`);
      setTimeout(() => this.connect(), 5000);
    }
  }

  private async setupQueue(queue: string, routingKey: string): Promise<void> {
    await this.channel.assertQueue(queue, {
      durable: true,
      arguments: {
        // Dead Letter Exchange — message lỗi đẩy vào DLQ để debug
        'x-dead-letter-exchange': `${EXCHANGE}.dlx`,
        'x-message-ttl': 86400000, // 24h TTL
      },
    });
    await this.channel.bindQueue(queue, EXCHANGE, routingKey);
  }

  private async startConsumers(): Promise<void> {
    // Prefetch = 1: xử lý tuần tự, tránh race condition khi update balance
    this.channel.prefetch(1);

    // Consumer: BuyShares
    await this.channel.consume(QUEUES.BUY_SHARES, async (msg) => {
      if (!msg) return;
      await this.processMessage(msg, (payload) =>
        this.eventConsumer.handleBuyShares(payload),
      );
    });

    // Consumer: SellShares
    await this.channel.consume(QUEUES.SELL_SHARES, async (msg) => {
      if (!msg) return;
      await this.processMessage(msg, (payload) =>
        this.eventConsumer.handleSellShares(payload),
      );
    });

    // Consumer: Graduated
    await this.channel.consume(QUEUES.GRADUATED, async (msg) => {
      if (!msg) return;
      await this.processMessage(msg, (payload) =>
        this.eventConsumer.handleArtworkGraduated(payload),
      );
    });
  }

  private async processMessage(
    msg: amqp.Message,
    handler: (payload: any) => Promise<void>,
  ): Promise<void> {
    const content = msg.content.toString();
    let payload: any;

    try {
      payload = JSON.parse(content);
    } catch {
      this.logger.error('Invalid JSON message, sending to DLQ');
      this.channel.nack(msg, false, false); // Không requeue — đẩy vào DLQ
      return;
    }

    try {
      await handler(payload);
      this.channel.ack(msg); // Ack sau khi xử lý thành công
    } catch (err) {
      this.logger.error(`Message processing failed: ${err.message}`, {
        payload,
        error: err.stack,
      });
      // requeue = false → đẩy vào DLQ sau MAX_RETRY (configure ở RabbitMQ policy)
      this.channel.nack(msg, false, false);
    }
  }
}
