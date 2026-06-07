// order-match.consumer.ts
// Consumes match results from Rust order matcher via RabbitMQ.
//
// Queues:
//   artcurve.orders   ← NestJS submits orders TO Rust
//   artcurve.matches  → Rust publishes filled results HERE
//   artcurve.rejects  → Rust publishes rejections HERE

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository }                  from '@nestjs/typeorm';
import { Repository, DataSource }            from 'typeorm';
import * as amqp                             from 'amqplib';

import { Artwork }           from '../../artworks/entities/artwork.entity';
import { Transaction, TransactionType } from '../../../database/entities/transaction.entity';
import { RedisService }      from '../../../shared/redis/redis.service';
import { EventsGateway }     from '../../gateway/events.gateway';

// ── Match result shape from Rust ─────────────────────────────────────────────

interface MatchResult {
  match_id:       string;
  order_id:       string;
  artwork_id:     string;
  user_wallet:    string;
  side:           'buy' | 'sell';
  filled_amount:  string;
  eth_amount:     string;
  avg_price:      string;
  new_spot_price: string;
  new_supply:     string;
  status:         string;
  would_graduate: boolean;
  matched_at:     string;
}

interface OrderRejected {
  order_id:   string;
  artwork_id: string;
  reason:     string;
  at:         string;
}

const QUEUE_ORDERS  = 'artcurve.orders';
const QUEUE_MATCHES = 'artcurve.matches';
const QUEUE_REJECTS = 'artcurve.rejects';

@Injectable()
export class OrderMatchConsumer implements OnModuleInit {
  private readonly logger = new Logger(OrderMatchConsumer.name);
  private conn:    amqp.Connection;
  private channel: amqp.Channel;

  constructor(
    private readonly ds:            DataSource,
    private readonly redis:         RedisService,
    private readonly eventsGateway: EventsGateway,
    @InjectRepository(Artwork)
    private readonly artworkRepo:   Repository<Artwork>,
    @InjectRepository(Transaction)
    private readonly txRepo:        Repository<Transaction>,
  ) {}

  async onModuleInit() {
    const url    = process.env.AMQP_URL ?? 'amqp://guest:guest@localhost:5672';
    this.conn    = await amqp.connect(url);
    this.channel = await this.conn.createChannel();

    // Declare all 3 queues (idempotent)
    for (const q of [QUEUE_ORDERS, QUEUE_MATCHES, QUEUE_REJECTS]) {
      await this.channel.assertQueue(q, { durable: true });
    }

    // Process one message at a time — preserve order, avoid race conditions
    await this.channel.prefetch(1);

    this.channel.consume(QUEUE_MATCHES, async (msg) => {
      if (!msg) return;
      try {
        const result: MatchResult = JSON.parse(msg.content.toString());
        await this.handleMatch(result);
        this.channel.ack(msg);
      } catch (e) {
        this.logger.error('match consumer error', e);
        this.channel.nack(msg, false, false);
      }
    });

    this.channel.consume(QUEUE_REJECTS, async (msg) => {
      if (!msg) return;
      try {
        const rejection: OrderRejected = JSON.parse(msg.content.toString());
        await this.handleRejection(rejection);
        this.channel.ack(msg);
      } catch (e) {
        this.logger.error('reject consumer error', e);
        this.channel.nack(msg, false, false);
      }
    });

    this.logger.log(`consuming from ${QUEUE_MATCHES} and ${QUEUE_REJECTS}`);
  }

  // ── Handle filled match ─────────────────────────────────────────────────────

  private async handleMatch(result: MatchResult): Promise<void> {
    const { artwork_id, side, filled_amount, eth_amount, new_spot_price, new_supply, would_graduate } = result;

    // 1. Update artwork price + supply atomically
    await this.artworkRepo.update(artwork_id, {
      current_price:  new_spot_price,
      current_supply: new_supply,
      ...(would_graduate ? { status: 'TARGET_REACHED' as any } : {}),
    });

    // 2. Persist transaction record
    const tx = this.txRepo.create({
      tx_hash:         result.match_id,
      artwork_id,
      user_id:         result.user_wallet,
      tx_type:         side === 'buy' ? TransactionType.BUY : TransactionType.SELL,
      share_amount:    filled_amount,
      eth_amount,
      price_per_share: result.avg_price,
      gas_fee:         '0',
      block_number:    '0',
      timestamp:       new Date(result.matched_at),
    });
    await this.txRepo.save(tx);

    // 3. Update Redis price cache
    await this.redis.setArtworkPrice(artwork_id, {
      current_price:  new_spot_price,
      current_supply: new_supply,
      volume_24h:     '0',
      updated_at:     result.matched_at,
    });

    // 4. Publish to Redis → Go WS Hub broadcasts to all viewers
    await this.redis.publishPriceUpdate({
      artwork_id,
      current_price:  new_spot_price,
      current_supply: new_supply,
      volume_24h:     '0',
      tx_hash:        result.match_id,
      timestamp:      Date.now(),
      is_buy:         side === 'buy',
      user_wallet:    result.user_wallet,
      share_amount:   filled_amount,
    });

    // 5. Broadcast trade event to authenticated WebSocket clients
    this.eventsGateway.broadcastTradeUpdated({
      artwork_id,
      tx_hash:         result.match_id,
      is_buy:          side === 'buy',
      user_wallet:     result.user_wallet,
      share_amount:    filled_amount,
      eth_amount,
      price_per_share: result.avg_price,
      block_number:    '0',
      timestamp:       Date.now(),
    });

    // 6. Handle graduation
    if (would_graduate) {
      this.eventsGateway.broadcastGraduated(artwork_id);
      this.logger.log(`[GRADUATION] artwork ${artwork_id} → triggering Uniswap migration`);
    }

    this.logger.log(
      `[MATCH] ${side} ${filled_amount} tokens @ ${result.avg_price} ETH/token | artwork=${artwork_id}`,
    );
  }

  // ── Handle rejected order ───────────────────────────────────────────────────

  private async handleRejection(rejection: OrderRejected): Promise<void> {
    this.logger.warn(`[REJECT] order=${rejection.order_id} | reason="${rejection.reason}"`);
    // Notify the specific user via WebSocket (user wallet identifies the socket room)
    // EventsGateway emits 'order_rejected' to room wallet:{user_wallet} when implemented
    // For now: log only — FE can poll order status via REST
  }

  // ── Submit order to Rust matcher ────────────────────────────────────────────

  async submitOrder(payload: Record<string, unknown>): Promise<void> {
    const msg = Buffer.from(JSON.stringify(payload));
    this.channel.sendToQueue(QUEUE_ORDERS, msg, { persistent: true });
  }
}
