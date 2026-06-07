// order-match.consumer.ts
// Consumes match results from Rust order matcher via RabbitMQ.
//
// Queues consumed:
//   artcurve.matches  → settle trade in PostgreSQL, update Redis cache, notify user
//   artcurve.rejects  → notify user of rejection via WebSocket

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository }                  from '@nestjs/typeorm';
import { Repository, DataSource }            from 'typeorm';
import amqp, { Channel, Connection }         from 'amqplib';

import { Artwork }       from '../../artworks/entities/artwork.entity';
import { Transaction }   from '../../../database/entities/transaction.entity';
import { RedisService }  from '../../../shared/redis/redis.service';
import { EventsGateway } from '../../gateway/events.gateway';

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
  status:         'open' | 'filled' | 'partially_filled' | 'cancelled' | 'rejected';
  would_graduate: boolean;
  matched_at:     string;
}

interface OrderRejected {
  order_id:   string;
  artwork_id: string;
  reason:     string;
  at:         string;
}

const QUEUE_MATCHES = 'artcurve.matches';
const QUEUE_REJECTS = 'artcurve.rejects';
const QUEUE_ORDERS  = 'artcurve.orders';

@Injectable()
export class OrderMatchConsumer implements OnModuleInit {
  private readonly logger = new Logger(OrderMatchConsumer.name);
  private conn: Connection;
  private channel: Channel;

  constructor(
    private readonly ds:             DataSource,
    private readonly redis:          RedisService,
    private readonly eventsGateway:  EventsGateway,
    @InjectRepository(Artwork)
    private readonly artworkRepo:    Repository<Artwork>,
    @InjectRepository(Transaction)
    private readonly txRepo:         Repository<Transaction>,
  ) {}

  async onModuleInit() {
    const url = process.env.AMQP_URL ?? 'amqp://guest:guest@localhost:5672';
    this.conn    = await amqp.connect(url);
    this.channel = await this.conn.createChannel();

    // Declare queues (idempotent)
    for (const q of [QUEUE_ORDERS, QUEUE_MATCHES, QUEUE_REJECTS]) {
      await this.channel.assertQueue(q, { durable: true });
    }

    // Consume 1 message at a time to preserve order
    this.channel.prefetch(1);

    this.channel.consume(QUEUE_MATCHES, async (msg) => {
      if (!msg) return;
      try {
        const result: MatchResult = JSON.parse(msg.content.toString());
        await this.handleMatch(result);
        this.channel.ack(msg);
      } catch (e) {
        this.logger.error('match consumer error', e);
        this.channel.nack(msg, false, false); // dead-letter
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

    // 1. Update artwork price + supply in PostgreSQL (atomic)
    await this.artworkRepo.update(artwork_id, {
      current_price:  new_spot_price,
      current_supply: new_supply,
      ...(would_graduate ? { status: 'TARGET_REACHED' as any } : {}),
    });

    // 2. Write transaction record
    await this.txRepo.save({
      tx_hash:         result.match_id, // use match_id as tx reference
      artwork_id,
      user_id:         result.user_wallet,
      tx_type:         side === 'buy' ? 'buy' : 'sell',
      share_amount:    filled_amount,
      eth_amount,
      price_per_share: result.avg_price,
      gas_fee:         '0',            // onchain gas handled separately
      block_number:    0,
      timestamp:       new Date(result.matched_at),
    });

    // 3. Update Redis price cache
    await this.redis.setArtworkPrice(artwork_id, {
      current_price:  new_spot_price,
      current_supply: new_supply,
      volume_24h:     '0', // updated separately by OHLCV aggregator
      updated_at:     result.matched_at,
    });

    // 4. Publish Redis price event → Go WS Hub broadcasts to viewers
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

    // 5. Broadcast trade event via NestJS EventsGateway (authenticated users)
    this.eventsGateway.broadcastTradeUpdate({
      artwork_id,
      order_id:      result.order_id,
      side,
      filled_amount,
      eth_amount,
      new_spot_price,
      new_supply,
      would_graduate,
    });

    // 6. Trigger graduation flow if needed
    if (would_graduate) {
      this.logger.log(`[GRADUATION] artwork ${artwork_id} reached target — triggering Uniswap migration`);
      // TODO: call blockchain producer to initiate graduation tx
    }

    this.logger.log(
      `[MATCH] ${side} ${filled_amount} tokens of ${artwork_id} for ${eth_amount} ETH @ ${result.avg_price}`
    );
  }

  // ── Handle rejected order ───────────────────────────────────────────────────

  private async handleRejection(rejection: OrderRejected): Promise<void> {
    this.logger.warn(`[REJECT] order=${rejection.order_id} reason="${rejection.reason}"`);

    // Notify user via WebSocket
    this.eventsGateway.broadcastOrderRejected({
      order_id:   rejection.order_id,
      artwork_id: rejection.artwork_id,
      reason:     rejection.reason,
    });
  }

  // ── Public: send order to Rust matcher ─────────────────────────────────────

  async submitOrder(payload: object): Promise<void> {
    const msg = Buffer.from(JSON.stringify(payload));
    this.channel.sendToQueue(QUEUE_ORDERS, msg, { persistent: true });
  }
}
