// order-match.consumer.ts
// Consumes match results from Rust order matcher via RabbitMQ.
//
// Queues:
//   artcurve.orders   <- NestJS submits orders TO Rust
//   artcurve.matches  -> Rust publishes filled results HERE
//   artcurve.rejects  -> Rust publishes rejections HERE

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository }                  from '@nestjs/typeorm';
import { Repository, DataSource }            from 'typeorm';
import * as amqp                             from 'amqplib';

// Use canonical entity paths — same as event.consumer.ts
import { Artwork }                          from '../../artworks/entities/artwork.entity';
import { Transaction, TransactionType }     from '../../trades/entities/transaction.entity';
import { PortfolioHolding }                 from '../../portfolio/entities/portfolio-holding.entity';
import { RedisService }                     from '../../../shared/redis/redis.service';
import { EventsGateway }                    from '../../gateway/events.gateway';
import { NotificationsService }             from '../../notifications/notifications.service';

// ── Match result shape from Rust ─────────────────────────────────────────────

interface MatchResult {
  match_id:       string;
  order_id:       string;
  artwork_id:     string;   // DB UUID (passed through from order submission)
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
  private conn:    amqp.ChannelModel;
  private channel: amqp.Channel;

  constructor(
    private readonly ds:            DataSource,
    private readonly redis:         RedisService,
    private readonly eventsGateway: EventsGateway,
    private readonly notifSvc:      NotificationsService,
    @InjectRepository(Artwork)
    private readonly artworkRepo:   Repository<Artwork>,
    @InjectRepository(Transaction)
    private readonly txRepo:        Repository<Transaction>,
    @InjectRepository(PortfolioHolding)
    private readonly holdingRepo:   Repository<PortfolioHolding>,
  ) {}

  async onModuleInit() {
    // Non-blocking: RabbitMQ có thể không có trong dev
    this.connect();
  }

  private async connect(): Promise<void> {
    const url = process.env.RABBITMQ_URL ?? process.env.AMQP_URL ?? 'amqp://guest:guest@localhost:5672';
    try {
      this.conn    = await amqp.connect(url) as amqp.ChannelModel;
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

      this.conn.on('error', (err) => {
        this.logger.error(`RabbitMQ connection error: ${err.message}`);
        setTimeout(() => this.connect(), 5000);
      });

      this.logger.log(`consuming from ${QUEUE_MATCHES} and ${QUEUE_REJECTS}`);
    } catch (err) {
      this.logger.error(`[OrderMatchConsumer] connect failed: ${(err as Error).message}`);
      setTimeout(() => this.connect(), 5000);
    }
  }

  // ── Lookup DB user UUID từ wallet address ────────────────────────────────────
  // transactions.user_id là UUID FK — không thể store wallet string trực tiếp.
  // Auto-create nếu chưa tồn tại (order đến trước khi user đăng ký web app).

  private async findOrCreateUser(walletAddress: string): Promise<string | null> {
    const wallet = walletAddress.toLowerCase();
    const rows = await this.ds.query(
      `SELECT id FROM users WHERE wallet_address = $1`,
      [wallet],
    );
    if (rows.length) return rows[0].id as string;

    await this.ds.query(
      `INSERT INTO users (wallet_address) VALUES ($1) ON CONFLICT (wallet_address) DO NOTHING`,
      [wallet],
    );
    const created = await this.ds.query(
      `SELECT id FROM users WHERE wallet_address = $1`,
      [wallet],
    );
    return (created[0]?.id as string) ?? null;
  }

  // ── Handle filled match ─────────────────────────────────────────────────────

  private async handleMatch(result: MatchResult): Promise<void> {
    const { artwork_id, side, filled_amount, eth_amount, new_spot_price, new_supply, would_graduate } = result;

    // Resolve user UUID — CRITICAL: user_id column is UUID FK, not wallet string
    const userId = await this.findOrCreateUser(result.user_wallet);
    if (!userId) {
      throw new Error(`Cannot resolve user for wallet=${result.user_wallet}`);
    }

    // 1. Update artwork price + supply atomically
    await this.artworkRepo.update(artwork_id, {
      current_price:  new_spot_price,
      current_supply: new_supply,
      ...(would_graduate ? { status: 'TARGET_REACHED' as any } : {}),
    });

    // 2. Upsert portfolio holding
    if (side === 'buy') {
      await this.ds.query(
        `INSERT INTO portfolio_holdings (user_id, artwork_id, share_balance, avg_buy_price)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, artwork_id) DO UPDATE
           SET share_balance = portfolio_holdings.share_balance + EXCLUDED.share_balance,
               avg_buy_price = (
                 portfolio_holdings.avg_buy_price * portfolio_holdings.share_balance
                 + EXCLUDED.avg_buy_price * EXCLUDED.share_balance
               ) / (portfolio_holdings.share_balance + EXCLUDED.share_balance),
               updated_at    = now()`,
        [userId, artwork_id, filled_amount, result.avg_price],
      );
    } else {
      await this.ds.query(
        `UPDATE portfolio_holdings
         SET share_balance = GREATEST(share_balance - $1, 0),
             updated_at    = now()
         WHERE user_id = $2 AND artwork_id = $3`,
        [filled_amount, userId, artwork_id],
      );
      await this.ds.query(
        `DELETE FROM portfolio_holdings
         WHERE user_id = $1 AND artwork_id = $2 AND share_balance <= 0`,
        [userId, artwork_id],
      );
    }

    // 3. Persist transaction record (user_id = UUID, not wallet)
    const tx = this.txRepo.create({
      tx_hash:         result.match_id,
      artwork_id,
      user_id:         userId,
      tx_type:         side === 'buy' ? TransactionType.BUY : TransactionType.SELL,
      share_amount:    filled_amount,
      eth_amount,
      price_per_share: result.avg_price,
      gas_fee:         '0',
      block_number:    '0',
      timestamp:       new Date(result.matched_at),
    });
    await this.txRepo.save(tx);

    // 4. Push notification cho user
    const artwork = await this.artworkRepo.findOne({ where: { id: artwork_id }, select: ['title'] });
    const artTitle = artwork?.title ?? artwork_id.slice(0, 8);
    const isBuy    = side === 'buy';
    const ethAmt   = parseFloat(eth_amount).toFixed(4);
    const tokenAmt = parseFloat(filled_amount).toFixed(0);
    this.notifSvc.create({
      user_id:     userId,
      type:        'trade',
      title:       `Lệnh ${isBuy ? 'BUY' : 'SELL'} đã khớp`,
      description: `${isBuy ? 'Mua' : 'Bán'} ${Number(tokenAmt).toLocaleString()} token — ${artTitle} · ${ethAmt} ETH`,
      metadata:    { artwork_id, tx_hash: result.match_id, side, eth_amount, filled_amount },
    }).catch(() => {/* non-blocking */});

    // 5. Update Redis price cache — accumulate volume from existing cache
    const existing = await this.redis.getArtworkPrice(artwork_id);
    const prevVol  = parseFloat(existing?.volume_24h ?? '0');
    const newVol   = (prevVol + parseFloat(eth_amount)).toFixed(18);

    await this.redis.setArtworkPrice(artwork_id, {
      current_price:  new_spot_price,
      current_supply: new_supply,
      volume_24h:     newVol,
      updated_at:     result.matched_at,
    });

    // 5. Publish to Redis → Go WS Hub broadcasts to all viewers
    await this.redis.publishPriceUpdate({
      artwork_id,
      current_price:  new_spot_price,
      current_supply: new_supply,
      volume_24h:     newVol,
      tx_hash:        result.match_id,
      timestamp:      Date.now(),
      is_buy:         side === 'buy',
      user_wallet:    result.user_wallet,
      share_amount:   filled_amount,
    });

    // 6. Broadcast trade event to authenticated WebSocket clients
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

    // 7. Handle graduation
    if (would_graduate) {
      this.eventsGateway.broadcastGraduated(artwork_id);
      this.logger.log(`[GRADUATION] artwork ${artwork_id} → triggering Uniswap migration`);
      this.notifSvc.create({
        user_id:     userId,
        type:        'graduation',
        title:       `"${artTitle}" đã graduate! 🎉`,
        description: 'Artwork đạt target cap — đang migrate lên Uniswap DEX',
        metadata:    { artwork_id },
      }).catch(() => {});
    }

    this.logger.log(
      `[MATCH] ${side} ${filled_amount} tokens @ ${result.avg_price} ETH/token | artwork=${artwork_id}`,
    );
  }

  // ── Handle rejected order ───────────────────────────────────────────────────

  private async handleRejection(rejection: OrderRejected): Promise<void> {
    this.logger.warn(`[REJECT] order=${rejection.order_id} | reason="${rejection.reason}"`);
    // FE polls order status via REST; WS order_rejected event can be added later
  }

  // ── Submit order to Rust matcher ────────────────────────────────────────────

  async submitOrder(payload: Record<string, unknown>): Promise<void> {
    this.channel.sendToQueue(QUEUE_ORDERS, Buffer.from(JSON.stringify(payload)), { persistent: true });
  }
}
