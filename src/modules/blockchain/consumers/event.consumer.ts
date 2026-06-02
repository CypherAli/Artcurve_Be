import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Transaction, TransactionType } from '../../trades/entities/transaction.entity';
import { Artwork, ArtworkStatus } from '../../artworks/entities/artwork.entity';
import { PortfolioHolding } from '../../portfolio/entities/portfolio-holding.entity';
import { RedisService } from '../../../shared/redis/redis.service';
import { ClickHouseBufferService } from '../../../shared/clickhouse/clickhouse-buffer.service';

// ── Event payload types tu blockchain indexer ─────────────────────────────────

interface BuySharesEventPayload {
  tx_hash:        string;
  user_wallet:    string;
  artwork_id:     string;
  share_amount:   string;
  eth_amount:     string;
  price_per_share: string;
  gas_fee:        string;
  block_number:   string;
  timestamp:      string;
}

interface SellSharesEventPayload extends BuySharesEventPayload {}

interface ArtworkGraduatedPayload {
  tx_hash:          string;
  artwork_id:       string;
  contract_address: string;
  block_number:     string;
  timestamp:        string;
}

// ── BlockchainEventConsumer ───────────────────────────────────────────────────
//
// "NHAC TRUONG" dong bo du lieu — nguoi DUY NHAT duoc ghi vao ca 3 DB:
//
//   PostgreSQL  — ACID transaction (source of truth)
//   Redis       — price cache + leaderboard + Pub/Sub (real-time)
//
// QUY TAC BAT BIEN:
//   1. Ghi PostgreSQL truoc (trong transaction)
//   2. Sau khi COMMIT thanh cong moi ghi Redis
//   3. REST API chi doc tu Redis, KHONG BAO GIO tu ghi Redis
//
// Neu Redis ghi that bai: khong rollback PG (da committed),
//   chi log warning — Redis se sync lai tu PG khi can thiet

@Injectable()
export class BlockchainEventConsumer {
  private readonly logger = new Logger(BlockchainEventConsumer.name);

  constructor(
    @InjectRepository(Transaction)
    private readonly txRepo: Repository<Transaction>,

    @InjectRepository(Artwork)
    private readonly artworkRepo: Repository<Artwork>,

    @InjectRepository(PortfolioHolding)
    private readonly holdingRepo: Repository<PortfolioHolding>,

    private readonly redisService:    RedisService,
    private readonly chBuffer:        ClickHouseBufferService,
  ) {}

  // ── handleBuyShares ────────────────────────────────────────────────────────

  async handleBuyShares(payload: BuySharesEventPayload): Promise<void> {
    const qr = this.txRepo.manager.connection.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();

    let newPrice: string = payload.price_per_share;
    let newSupply: string | null = null;

    try {
      // Idempotency check — tx_hash UNIQUE constraint ngan ghi dup
      const existing = await qr.manager.findOne(Transaction, {
        where: { tx_hash: payload.tx_hash },
        select: ['id'],
      });

      if (existing) {
        this.logger.warn(`Duplicate BuyShares: ${payload.tx_hash} — skipping`);
        await qr.rollbackTransaction();
        return;
      }

      const user = await qr.manager.query(
        `SELECT id FROM users WHERE wallet_address = $1`,
        [payload.user_wallet.toLowerCase()],
      );
      if (!user.length) throw new Error(`User not found: ${payload.user_wallet}`);
      const userId = user[0].id;

      // 1. Ghi transaction vao PostgreSQL
      await qr.manager.query(
        `INSERT INTO transactions
          (tx_hash, user_id, artwork_id, tx_type, share_amount, eth_amount,
           price_per_share, gas_fee, block_number, timestamp)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (tx_hash) DO NOTHING`,
        [
          payload.tx_hash, userId, payload.artwork_id,
          TransactionType.BUY, payload.share_amount, payload.eth_amount,
          payload.price_per_share, payload.gas_fee, payload.block_number,
          new Date(parseInt(payload.timestamp) * 1000),
        ],
      );

      // 2. Upsert portfolio holdings
      await qr.manager.query(
        `INSERT INTO portfolio_holdings (user_id, artwork_id, share_balance, avg_buy_price)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, artwork_id) DO UPDATE
           SET share_balance = portfolio_holdings.share_balance + EXCLUDED.share_balance,
               avg_buy_price = (
                 portfolio_holdings.avg_buy_price * portfolio_holdings.share_balance
                 + EXCLUDED.avg_buy_price * EXCLUDED.share_balance
               ) / (portfolio_holdings.share_balance + EXCLUDED.share_balance),
               updated_at = now()`,
        [userId, payload.artwork_id, payload.share_amount, payload.price_per_share],
      );

      // 3. Cap nhat artwork price + supply — lay ket qua moi nhat
      const updated = await qr.manager.query(
        `UPDATE artworks
         SET current_supply = current_supply + $1,
             current_price  = $2,
             updated_at     = now()
         WHERE id = $3
         RETURNING current_supply, current_price`,
        [payload.share_amount, payload.price_per_share, payload.artwork_id],
      );

      if (updated.length) {
        newPrice  = updated[0].current_price;
        newSupply = updated[0].current_supply;
      }

      // ── COMMIT POSTGRESQL TRUOC ─────────────────────────────────────────
      await qr.commitTransaction();
      this.logger.log(`[PG] BuyShares committed: tx=${payload.tx_hash}`);

    } catch (err) {
      await qr.rollbackTransaction();
      this.logger.error(`[PG] BuyShares failed: ${err.message}`, err.stack);
      throw err; // Nem lai de RabbitMQ nack -> DLQ
    } finally {
      await qr.release();
    }

    // ── SAU KHI COMMIT: Ghi Redis dong thoi ────────────────────────────────
    // Neu Redis loi -> chi log, khong rollback PG
    try {
      await Promise.all([
        // Cap nhat price cache
        this.redisService.setArtworkPrice(payload.artwork_id, {
          current_price:  newPrice,
          current_supply: newSupply ?? payload.share_amount,
          volume_24h:     payload.eth_amount,
          updated_at:     new Date().toISOString(),
        }),

        // Tang leaderboard volume
        this.redisService.incrementLeaderboard(payload.artwork_id, payload.eth_amount),

        // Publish cho WebSocket Gateway -> Frontend
        this.redisService.publishPriceUpdate({
          artwork_id:     payload.artwork_id,
          current_price:  newPrice,
          current_supply: newSupply ?? '0',
          volume_24h:     payload.eth_amount,
          tx_hash:        payload.tx_hash,
          timestamp:      Date.now(),
        }),
      ]);

      this.logger.log(`[Redis] BuyShares synced: artwork=${payload.artwork_id} price=${newPrice}`);
    } catch (redisErr) {
      this.logger.warn(`[Redis] Sync failed (PG committed): ${redisErr.message}`);
    }

    // ── 3. ClickHouse — gom vao buffer, khong insert truc tiep ────────────
    // chBuffer.add() la DONG BO O(1): chi push vao mang, khong await
    // Buffer tu flush khi dat 100 rows HOAC 5 giay troi qua
    // -> Tranh "Too many parts" crash cua ClickHouse
    this.chBuffer.add({
      artwork_id:      payload.artwork_id,
      tx_hash:         payload.tx_hash,
      user_id:         '', // se cap nhat khi co userId
      tx_type:         'buy',
      share_amount:    payload.share_amount,
      eth_amount:      payload.eth_amount,
      price_per_share: newPrice,
      gas_fee:         payload.gas_fee,
      block_number:    parseInt(payload.block_number),
      timestamp:       new Date(parseInt(payload.timestamp) * 1000),
    });
  }

  // ── handleSellShares ───────────────────────────────────────────────────────

  async handleSellShares(payload: SellSharesEventPayload): Promise<void> {
    const qr = this.txRepo.manager.connection.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();

    let newPrice: string = payload.price_per_share;
    let newSupply: string | null = null;

    try {
      const existing = await qr.manager.findOne(Transaction, {
        where: { tx_hash: payload.tx_hash }, select: ['id'],
      });
      if (existing) {
        this.logger.warn(`Duplicate SellShares: ${payload.tx_hash} — skipping`);
        await qr.rollbackTransaction();
        return;
      }

      const user = await qr.manager.query(
        `SELECT id FROM users WHERE wallet_address = $1`,
        [payload.user_wallet.toLowerCase()],
      );
      if (!user.length) throw new Error(`User not found: ${payload.user_wallet}`);
      const userId = user[0].id;

      await qr.manager.query(
        `INSERT INTO transactions
          (tx_hash, user_id, artwork_id, tx_type, share_amount, eth_amount,
           price_per_share, gas_fee, block_number, timestamp)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (tx_hash) DO NOTHING`,
        [
          payload.tx_hash, userId, payload.artwork_id,
          TransactionType.SELL, payload.share_amount, payload.eth_amount,
          payload.price_per_share, payload.gas_fee, payload.block_number,
          new Date(parseInt(payload.timestamp) * 1000),
        ],
      );

      await qr.manager.query(
        `UPDATE portfolio_holdings
         SET share_balance = share_balance - $1, updated_at = now()
         WHERE user_id = $2 AND artwork_id = $3`,
        [payload.share_amount, userId, payload.artwork_id],
      );

      const updated = await qr.manager.query(
        `UPDATE artworks
         SET current_supply = current_supply - $1,
             current_price  = $2,
             updated_at     = now()
         WHERE id = $3
         RETURNING current_supply, current_price`,
        [payload.share_amount, payload.price_per_share, payload.artwork_id],
      );

      if (updated.length) {
        newPrice  = updated[0].current_price;
        newSupply = updated[0].current_supply;
      }

      await qr.commitTransaction();
      this.logger.log(`[PG] SellShares committed: tx=${payload.tx_hash}`);

    } catch (err) {
      await qr.rollbackTransaction();
      this.logger.error(`[PG] SellShares failed: ${err.message}`, err.stack);
      throw err;
    } finally {
      await qr.release();
    }

    // Redis sync sau commit
    try {
      await Promise.all([
        this.redisService.setArtworkPrice(payload.artwork_id, {
          current_price:  newPrice,
          current_supply: newSupply ?? '0',
          volume_24h:     payload.eth_amount,
          updated_at:     new Date().toISOString(),
        }),
        this.redisService.incrementLeaderboard(payload.artwork_id, payload.eth_amount),
        this.redisService.publishPriceUpdate({
          artwork_id:     payload.artwork_id,
          current_price:  newPrice,
          current_supply: newSupply ?? '0',
          volume_24h:     payload.eth_amount,
          tx_hash:        payload.tx_hash,
          timestamp:      Date.now(),
        }),
      ]);
    } catch (redisErr) {
      this.logger.warn(`[Redis] Sync failed: ${redisErr.message}`);
    }

    // ── ClickHouse — gom vao buffer, khong insert truc tiep ────────────────
    this.chBuffer.add({
      artwork_id:      payload.artwork_id,
      tx_hash:         payload.tx_hash,
      user_id:         '',
      tx_type:         'sell',
      share_amount:    payload.share_amount,
      eth_amount:      payload.eth_amount,
      price_per_share: newPrice,
      gas_fee:         payload.gas_fee,
      block_number:    parseInt(payload.block_number),
      timestamp:       new Date(parseInt(payload.timestamp) * 1000),
    });
  }

  // ── handleArtworkGraduated ─────────────────────────────────────────────────

  async handleArtworkGraduated(payload: ArtworkGraduatedPayload): Promise<void> {
    const qr = this.artworkRepo.manager.connection.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();

    try {
      const existing = await qr.manager.findOne(Transaction, {
        where: { tx_hash: payload.tx_hash }, select: ['id'],
      });
      if (existing) {
        this.logger.warn(`Duplicate Graduated: ${payload.tx_hash} — skipping`);
        await qr.rollbackTransaction();
        return;
      }

      await qr.manager.query(
        `UPDATE artworks
         SET status = $1, contract_address = $2, updated_at = now()
         WHERE id = $3`,
        [ArtworkStatus.GRADUATED, payload.contract_address, payload.artwork_id],
      );

      const artwork = await qr.manager.query(
        `SELECT current_supply, current_price FROM artworks WHERE id = $1`,
        [payload.artwork_id],
      );

      if (artwork.length) {
        await qr.manager.query(
          `INSERT INTO transactions
            (tx_hash, user_id, artwork_id, tx_type, share_amount, eth_amount,
             price_per_share, block_number, timestamp)
           SELECT $1, creator_id, $2, $3, $4, current_supply * current_price, $5, $6, $7
           FROM artworks WHERE id = $2
           ON CONFLICT (tx_hash) DO NOTHING`,
          [
            payload.tx_hash, payload.artwork_id, TransactionType.GRADUATE,
            artwork[0].current_supply, artwork[0].current_price,
            payload.block_number,
            new Date(parseInt(payload.timestamp) * 1000),
          ],
        );
      }

      await qr.commitTransaction();
      this.logger.log(`[PG] Artwork graduated: id=${payload.artwork_id}`);

    } catch (err) {
      await qr.rollbackTransaction();
      this.logger.error(`[PG] Graduated failed: ${err.message}`, err.stack);
      throw err;
    } finally {
      await qr.release();
    }

    // Notify tat ca clients dang theo doi artwork nay
    try {
      await this.redisService.publishArtworkGraduated(payload.artwork_id);
    } catch (redisErr) {
      this.logger.warn(`[Redis] Graduated publish failed: ${redisErr.message}`);
    }
  }
}
