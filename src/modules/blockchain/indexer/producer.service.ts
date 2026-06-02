import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as amqpConnectionManager from 'amqp-connection-manager';
import type { AmqpConnectionManager, ChannelWrapper } from 'amqp-connection-manager';

// ─────────────────────────────────────────────────────────────────────────────
//  ProducerService  (src/modules/blockchain/indexer/)
//
//  Publish raw JSON messages lên RabbitMQ exchange artcurve.blockchain.
//  Wire format: plain JSON buffer — tương thích consumer raw amqplib.
//
//  Exchange: artcurve.blockchain (topic, durable)
//  Queues:
//    artcurve.artwork.created  ← routing: blockchain.artwork.created
//    artcurve.trade.executed   ← routing: blockchain.trade.executed
//    artcurve.tx.graduated     ← routing: blockchain.graduated
// ─────────────────────────────────────────────────────────────────────────────

const EXCHANGE = 'artcurve.blockchain';
const DLX      = `${EXCHANGE}.dlx`;

// ── Payload types ─────────────────────────────────────────────────────────────

export interface ArtworkCreatedPayload {
  tx_hash:      string;
  amm_address:  string;
  creator:      string;
  metadata_cid: string;
  artwork_id:   string;   // on-chain sequential ID
  target_cap:   string;
  block_number: string;
  timestamp:    string;   // unix seconds
}

export interface TradeExecutedPayload {
  tx_hash:         string;
  amm_address:     string;
  user_wallet:     string;
  artwork_id:      string;
  is_buy:          boolean;
  share_amount:    string;
  eth_amount:      string;
  price_per_share: string;
  block_number:    string;
  timestamp:       string;
}

export interface GraduatedPayload {
  tx_hash:         string;
  amm_address:     string;
  artwork_id:      string;
  total_liquidity: string;
  block_number:    string;
  timestamp:       string;
}

@Injectable()
export class ProducerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ProducerService.name);
  private connection: AmqpConnectionManager;
  private channel: ChannelWrapper;

  private readonly routingArtwork:  string;
  private readonly routingTrade:    string;
  private readonly routingGraduated: string;
  private readonly queueArtwork:    string;
  private readonly queueTrade:      string;
  private readonly queueGraduated:  string;

  constructor(private readonly config: ConfigService) {
    this.routingArtwork   = config.get('ARTWORK_CREATED_ROUTING_KEY', 'blockchain.artwork.created');
    this.routingTrade     = config.get('TRADE_EXECUTED_ROUTING_KEY',  'blockchain.trade.executed');
    this.routingGraduated = config.get('GRADUATED_ROUTING_KEY',       'blockchain.graduated');
    this.queueArtwork     = config.get('ARTWORK_CREATED_QUEUE',       'artcurve.artwork.created');
    this.queueTrade       = config.get('TRADE_EXECUTED_QUEUE',        'artcurve.trade.executed');
    this.queueGraduated   = config.get('GRADUATED_QUEUE',             'artcurve.tx.graduated');
  }

  async onModuleInit(): Promise<void> {
    const url = this.config.get<string>('RABBITMQ_URL', 'amqp://localhost:5672');
    this.connection = amqpConnectionManager.connect(url);
    this.connection.on('connect',    () => this.logger.log('RabbitMQ producer connected'));
    this.connection.on('disconnect', (e) => this.logger.warn(`RabbitMQ disconnected: ${e?.err?.message}`));

    this.channel = this.connection.createChannel({
      json: false,
      setup: async (ch: any) => {
        await ch.assertExchange(EXCHANGE, 'topic', { durable: true });
        await ch.assertExchange(DLX,      'topic', { durable: true });
        const opts = { durable: true, arguments: { 'x-dead-letter-exchange': DLX, 'x-message-ttl': 86400000 } };
        await ch.assertQueue(this.queueArtwork,   opts);
        await ch.assertQueue(this.queueTrade,     opts);
        await ch.assertQueue(this.queueGraduated, opts);
        await ch.bindQueue(this.queueArtwork,   EXCHANGE, this.routingArtwork);
        await ch.bindQueue(this.queueTrade,     EXCHANGE, this.routingTrade);
        await ch.bindQueue(this.queueGraduated, EXCHANGE, this.routingGraduated);
        this.logger.log('RabbitMQ producer channel ready');
      },
    });
    // Non-blocking: do not await — RabbitMQ may be unavailable in dev.
    // amqp-connection-manager will keep retrying in the background.
    this.channel.waitForConnect().catch((err) =>
      this.logger.warn(`RabbitMQ producer connect skipped: ${err?.message}`),
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.channel?.close();
    await this.connection?.close();
  }

  async publishArtworkCreated(p: ArtworkCreatedPayload): Promise<void> {
    await this.publish(this.routingArtwork, p);
  }

  async publishTradeExecuted(p: TradeExecutedPayload): Promise<void> {
    await this.publish(this.routingTrade, p);
  }

  async publishGraduated(p: GraduatedPayload): Promise<void> {
    await this.publish(this.routingGraduated, p);
  }

  private async publish(routingKey: string, payload: unknown): Promise<void> {
    const content = Buffer.from(JSON.stringify(payload));
    try {
      await this.channel.publish(EXCHANGE, routingKey, content, {
        persistent:  true,
        contentType: 'application/json',
        timestamp:   Math.floor(Date.now() / 1000),
      });
    } catch (err) {
      this.logger.error(`Publish failed [${routingKey}]: ${(err as Error).message}`);
      throw err;
    }
  }
}
