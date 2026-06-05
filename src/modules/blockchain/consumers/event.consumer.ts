import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Transaction, TransactionType } from '../../trades/entities/transaction.entity';
import { Artwork, ArtworkStatus } from '../../artworks/entities/artwork.entity';
import { PortfolioHolding } from '../../portfolio/entities/portfolio-holding.entity';
import { RedisService } from '../../../shared/redis/redis.service';
import { ClickHouseBufferService } from '../../../shared/clickhouse/clickhouse-buffer.service';

// ─────────────────────────────────────────────────────────────────────────────
//  BlockchainEventConsumer — "NHẠC TRƯỞNG" đồng bộ dữ liệu
//
//  Nhận payload từ RabbitMQ (đã khớp với ProducerService) và thực hiện:
//    1. PostgreSQL ACID transaction (source of truth)
//    2. Redis cache + Pub/Sub (real-time)
//    3. ClickHouse buffer (analytics)
//
//  PAYLOAD TYPES khớp chính xác với producer.service.ts:
//    ArtworkCreatedPayload : amm_address, creator, artwork_id (onchain), metadata_cid, ...
//    TradeExecutedPayload  : amm_address, user_wallet, artwork_id (onchain), is_buy, ...
//    GraduatedPayload      : amm_address, artwork_id (onchain), total_liquidity, ...
//
//  KEY DESIGN DECISION:
//    artwork_id từ blockchain là on-chain sequential ID (string số nguyên).
//    Để lookup DB UUID: SELECT id FROM artworks WHERE amm_address = $1
//    amm_address được set bởi handleArtworkCreated.
// ─────────────────────────────────────────────────────────────────────────────

// ── Payload types — khớp với producer.service.ts ─────────────────────────────

interface ArtworkCreatedPayload {
  tx_hash:      string;
  amm_address:  string;   // địa chỉ AMM clone → dùng để set trên artwork
  creator:      string;   // wallet address của creator
  metadata_cid: string;
  artwork_id:   string;   // on-chain sequential ID
  target_cap:   string;
  block_number: string;
  timestamp:    string;
}

interface TradeExecutedPayload {
  tx_hash:         string;
  amm_address:     string;   // KEY: dùng để lookup artwork UUID trong DB
  user_wallet:     string;
  artwork_id:      string;   // on-chain ID — KHÔNG dùng trực tiếp làm DB FK
  is_buy:          boolean;
  share_amount:    string;
  eth_amount:      string;
  price_per_share: string;
  block_number:    string;
  timestamp:       string;
}

interface ArtworkGraduatedPayload {
  tx_hash:         string;
  amm_address:     string;
  artwork_id:      string;
  total_liquidity: string;
  block_number:    string;
  timestamp:       string;
}

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

    private readonly redisService: RedisService,
    private readonly chBuffer:     ClickHouseBufferService,
  ) {}

  // ── Helpers ────────────────────────────────────────────────────────────────

  /**
   * Lookup DB artwork UUID từ amm_address.
   * Đây là bridge giữa on-chain world (contract address) và DB world (UUID).
   */
  private async findArtworkIdByAmm(
    qr: any,
    ammAddress: string,
  ): Promise<string | null> {
    const rows = await qr.manager.query(
      `SELECT id FROM artworks WHERE amm_address = $1`,
      [ammAddress.toLowerCase()],
    );
    return rows[0]?.id ?? null;
  }

  /**
   * Lookup DB user UUID từ wallet address.
   * Auto-create user nếu chưa tồn tại (on-chain first user).
   */
  private async findOrCreateUser(
    qr: any,
    walletAddress: string,
  ): Promise<string | null> {
    const wallet = walletAddress.toLowerCase();
    const rows = await qr.manager.query(
      `SELECT id FROM users WHERE wallet_address = $1`,
      [wallet],
    );
    if (rows.length) return rows[0].id;

    // Auto-upsert: user trade on-chain trước khi đăng ký web app
    await qr.manager.query(
      `INSERT INTO users (wallet_address) VALUES ($1) ON CONFLICT (wallet_address) DO NOTHING`,
      [wallet],
    );
    const created = await qr.manager.query(
      `SELECT id FROM users WHERE wallet_address = $1`,
      [wallet],
    );
    return created[0]?.id ?? null;
  }

  // ── handleArtworkCreated ───────────────────────────────────────────────────
  //
  // Khi ArtFactory deploy AMM clone mới:
  //   1. Tìm artwork DRAFT của creator (gần nhất chưa có amm_address)
  //   2. Set amm_address + onchain_id + contract_address + status=ACTIVE
  //
  // Thiết kế: khớp artwork theo creator + DRAFT + không có amm_address
  // (vì artist chỉ có thể deploy 1 artwork tại 1 thời điểm — Studio flow)

  async handleArtworkCreated(payload: ArtworkCreatedPayload): Promise<void> {
    const qr = this.artworkRepo.manager.connection.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();

    try {
      const creator = payload.creator.toLowerCase();
      const ammAddr = payload.amm_address.toLowerCase();

      // Idempotency: nếu đã có artwork với amm_address này → skip
      const existing = await qr.manager.query(
        `SELECT id FROM artworks WHERE amm_address = $1`,
        [ammAddr],
      );
      if (existing.length) {
        this.logger.warn(`[ArtworkCreated] amm_address=${ammAddr} already mapped — skipping`);
        await qr.rollbackTransaction();
        return;
      }

      // Tìm user từ creator wallet
      const userRows = await qr.manager.query(
        `SELECT id FROM users WHERE wallet_address = $1`,
        [creator],
      );
      if (!userRows.length) {
        throw new Error(`Creator not found in DB: ${creator}`);
      }
      const creatorId = userRows[0].id;

      // Tìm artwork DRAFT gần nhất của creator chưa được map
      const artworkRows = await qr.manager.query(
        `SELECT id FROM artworks
         WHERE creator_id = $1
           AND status = $2
           AND amm_address IS NULL
         ORDER BY created_at DESC
         LIMIT 1`,
        [creatorId, ArtworkStatus.DRAFT],
      );

      if (!artworkRows.length) {
        throw new Error(`No pending DRAFT artwork for creator ${creator}`);
      }
      const artworkId = artworkRows[0].id;

      // Set amm_address, onchain_id, contract_address, ACTIVE
      await qr.manager.query(
        `UPDATE artworks
         SET amm_address      = $1,
             onchain_id       = $2,
             contract_address = $1,
             status           = $3,
             updated_at       = now()
         WHERE id = $4`,
        [ammAddr, payload.artwork_id, ArtworkStatus.ACTIVE, artworkId],
      );

      await qr.commitTransaction();
      this.logger.log(
        `[ArtworkCreated] Mapped amm=${ammAddr} → artworkId=${artworkId} (onchain=${payload.artwork_id})`,
      );
    } catch (err) {
      await qr.rollbackTransaction();
      this.logger.error(`[ArtworkCreated] Failed: ${err.message}`, err.stack);
      throw err;
    } finally {
      await qr.release();
    }
  }

  // ── handleBuyShares ────────────────────────────────────────────────────────

  async handleBuyShares(payload: TradeExecutedPayload): Promise<void> {
    const qr = this.txRepo.manager.connection.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();

    let newPrice: string  = payload.price_per_share;
    let newSupply: string | null = null;
    let artworkDbId: string | null = null;
    let userId: string | null = null;

    try {
      // Idempotency check
      const existing = await qr.manager.findOne(Transaction, {
        where: { tx_hash: payload.tx_hash }, select: ['id'],
      });
      if (existing) {
        this.logger.warn(`Duplicate BuyShares: ${payload.tx_hash} — skipping`);
        await qr.rollbackTransaction();
        return;
      }

      // Lookup artwork UUID từ amm_address (không dùng on-chain artwork_id)
      artworkDbId = await this.findArtworkIdByAmm(qr, payload.amm_address);
      if (!artworkDbId) {
        throw new Error(`Artwork not found for amm_address=${payload.amm_address}`);
      }

      // Lookup / auto-create user
      userId = await this.findOrCreateUser(qr, payload.user_wallet);
      if (!userId) {
        throw new Error(`Cannot resolve user for wallet=${payload.user_wallet}`);
      }

      // 1. Insert transaction
      await qr.manager.query(
        `INSERT INTO transactions
          (tx_hash, user_id, artwork_id, tx_type, share_amount, eth_amount,
           price_per_share, gas_fee, block_number, timestamp)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (tx_hash) DO NOTHING`,
        [
          payload.tx_hash, userId, artworkDbId,
          TransactionType.BUY, payload.share_amount, payload.eth_amount,
          payload.price_per_share,
          '0',  // gas_fee không có trong TradeExecutedPayload — set 0
          payload.block_number,
          new Date(parseInt(payload.timestamp) * 1000),
        ],
      );

      // 2. Upsert portfolio holding — weighted average buy price
      await qr.manager.query(
        `INSERT INTO portfolio_holdings (user_id, artwork_id, share_balance, avg_buy_price)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, artwork_id) DO UPDATE
           SET share_balance = portfolio_holdings.share_balance + EXCLUDED.share_balance,
               avg_buy_price = (
                 portfolio_holdings.avg_buy_price * portfolio_holdings.share_balance
                 + EXCLUDED.avg_buy_price * EXCLUDED.share_balance
               ) / (portfolio_holdings.share_balance + EXCLUDED.share_balance),
               updated_at    = now()`,
        [userId, artworkDbId, payload.share_amount, payload.price_per_share],
      );

      // 3. Update artwork current_supply + current_price
      const updated = await qr.manager.query(
        `UPDATE artworks
         SET current_supply = current_supply + $1,
             current_price  = $2,
             updated_at     = now()
         WHERE id = $3
         RETURNING current_supply, current_price`,
        [payload.share_amount, payload.price_per_share, artworkDbId],
      );
      if (updated.length) {
        newPrice  = updated[0].current_price;
        newSupply = updated[0].current_supply;
      }

      await qr.commitTransaction();
      this.logger.log(`[PG] BuyShares committed: tx=${payload.tx_hash} artwork=${artworkDbId}`);

    } catch (err) {
      await qr.rollbackTransaction();
      this.logger.error(`[PG] BuyShares failed: ${err.message}`, err.stack);
      throw err;
    } finally {
      await qr.release();
    }

    // Redis sync (sau khi PG committed)
    try {
      await Promise.all([
        this.redisService.setArtworkPrice(artworkDbId!, {
          current_price:  newPrice,
          current_supply: newSupply ?? payload.share_amount,
          volume_24h:     payload.eth_amount,
          updated_at:     new Date().toISOString(),
        }),
        this.redisService.incrementLeaderboard(artworkDbId!, payload.eth_amount),
        this.redisService.publishPriceUpdate({
          artwork_id:     artworkDbId!,
          current_price:  newPrice,
          current_supply: newSupply ?? '0',
          volume_24h:     payload.eth_amount,
          tx_hash:        payload.tx_hash,
          is_buy:         true,
          user_wallet:    payload.user_wallet,
          share_amount:   payload.share_amount,
          timestamp:      Date.now(),
        }),
      ]);
      this.logger.log(`[Redis] BuyShares synced: artwork=${artworkDbId} price=${newPrice}`);
    } catch (redisErr) {
      this.logger.warn(`[Redis] Sync failed (PG committed): ${redisErr.message}`);
    }

    // ClickHouse buffer — dùng userId thật
    this.chBuffer.add({
      artwork_id:      artworkDbId!,
      tx_hash:         payload.tx_hash,
      user_id:         userId!,
      tx_type:         'buy',
      share_amount:    payload.share_amount,
      eth_amount:      payload.eth_amount,
      price_per_share: newPrice,
      gas_fee:         '0',
      block_number:    parseInt(payload.block_number),
      timestamp:       new Date(parseInt(payload.timestamp) * 1000),
    });
  }

  // ── handleSellShares ───────────────────────────────────────────────────────

  async handleSellShares(payload: TradeExecutedPayload): Promise<void> {
    const qr = this.txRepo.manager.connection.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();

    let newPrice: string  = payload.price_per_share;
    let newSupply: string | null = null;
    let artworkDbId: string | null = null;
    let userId: string | null = null;

    try {
      const existing = await qr.manager.findOne(Transaction, {
        where: { tx_hash: payload.tx_hash }, select: ['id'],
      });
      if (existing) {
        this.logger.warn(`Duplicate SellShares: ${payload.tx_hash} — skipping`);
        await qr.rollbackTransaction();
        return;
      }

      artworkDbId = await this.findArtworkIdByAmm(qr, payload.amm_address);
      if (!artworkDbId) {
        throw new Error(`Artwork not found for amm_address=${payload.amm_address}`);
      }

      userId = await this.findOrCreateUser(qr, payload.user_wallet);
      if (!userId) {
        throw new Error(`Cannot resolve user for wallet=${payload.user_wallet}`);
      }

      await qr.manager.query(
        `INSERT INTO transactions
          (tx_hash, user_id, artwork_id, tx_type, share_amount, eth_amount,
           price_per_share, gas_fee, block_number, timestamp)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (tx_hash) DO NOTHING`,
        [
          payload.tx_hash, userId, artworkDbId,
          TransactionType.SELL, payload.share_amount, payload.eth_amount,
          payload.price_per_share, '0', payload.block_number,
          new Date(parseInt(payload.timestamp) * 1000),
        ],
      );

      // Giảm holding — nếu về 0 thì xóa row
      await qr.manager.query(
        `UPDATE portfolio_holdings
         SET share_balance = GREATEST(share_balance - $1, 0),
             updated_at    = now()
         WHERE user_id = $2 AND artwork_id = $3`,
        [payload.share_amount, userId, artworkDbId],
      );
      // Xóa holding = 0 để giữ DB gọn
      await qr.manager.query(
        `DELETE FROM portfolio_holdings
         WHERE user_id = $1 AND artwork_id = $2 AND share_balance <= 0`,
        [userId, artworkDbId],
      );

      const updated = await qr.manager.query(
        `UPDATE artworks
         SET current_supply = GREATEST(current_supply - $1, 0),
             current_price  = $2,
             updated_at     = now()
         WHERE id = $3
         RETURNING current_supply, current_price`,
        [payload.share_amount, payload.price_per_share, artworkDbId],
      );
      if (updated.length) {
        newPrice  = updated[0].current_price;
        newSupply = updated[0].current_supply;
      }

      await qr.commitTransaction();
      this.logger.log(`[PG] SellShares committed: tx=${payload.tx_hash} artwork=${artworkDbId}`);

    } catch (err) {
      await qr.rollbackTransaction();
      this.logger.error(`[PG] SellShares failed: ${err.message}`, err.stack);
      throw err;
    } finally {
      await qr.release();
    }

    try {
      await Promise.all([
        this.redisService.setArtworkPrice(artworkDbId!, {
          current_price:  newPrice,
          current_supply: newSupply ?? '0',
          volume_24h:     payload.eth_amount,
          updated_at:     new Date().toISOString(),
        }),
        this.redisService.incrementLeaderboard(artworkDbId!, payload.eth_amount),
        this.redisService.publishPriceUpdate({
          artwork_id:     artworkDbId!,
          current_price:  newPrice,
          current_supply: newSupply ?? '0',
          volume_24h:     payload.eth_amount,
          tx_hash:        payload.tx_hash,
          is_buy:         false,
          user_wallet:    payload.user_wallet,
          share_amount:   payload.share_amount,
          timestamp:      Date.now(),
        }),
      ]);
    } catch (redisErr) {
      this.logger.warn(`[Redis] Sync failed: ${redisErr.message}`);
    }

    this.chBuffer.add({
      artwork_id:      artworkDbId!,
      tx_hash:         payload.tx_hash,
      user_id:         userId!,
      tx_type:         'sell',
      share_amount:    payload.share_amount,
      eth_amount:      payload.eth_amount,
      price_per_share: newPrice,
      gas_fee:         '0',
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

      const artworkDbId = await this.findArtworkIdByAmm(qr, payload.amm_address);
      if (!artworkDbId) {
        throw new Error(`Artwork not found for amm_address=${payload.amm_address}`);
      }

      await qr.manager.query(
        `UPDATE artworks
         SET status = $1, updated_at = now()
         WHERE id = $2`,
        [ArtworkStatus.GRADUATED, artworkDbId],
      );

      // Ghi GRADUATE transaction cho lịch sử
      const artwork = await qr.manager.query(
        `SELECT current_supply, current_price, creator_id FROM artworks WHERE id = $1`,
        [artworkDbId],
      );
      if (artwork.length) {
        await qr.manager.query(
          `INSERT INTO transactions
            (tx_hash, user_id, artwork_id, tx_type, share_amount, eth_amount,
             price_per_share, gas_fee, block_number, timestamp)
           VALUES ($1, $2, $3, $4, $5, $6, $7, '0', $8, $9)
           ON CONFLICT (tx_hash) DO NOTHING`,
          [
            payload.tx_hash,
            artwork[0].creator_id,
            artworkDbId,
            TransactionType.GRADUATE,
            artwork[0].current_supply,
            payload.total_liquidity,
            artwork[0].current_price,
            payload.block_number,
            new Date(parseInt(payload.timestamp) * 1000),
          ],
        );
      }

      await qr.commitTransaction();
      this.logger.log(`[PG] Graduated: artworkId=${artworkDbId}`);

    } catch (err) {
      await qr.rollbackTransaction();
      this.logger.error(`[PG] Graduated failed: ${err.message}`, err.stack);
      throw err;
    } finally {
      await qr.release();
    }

    try {
      await this.redisService.publishArtworkGraduated(payload.amm_address);
    } catch (redisErr) {
      this.logger.warn(`[Redis] Graduated publish failed: ${redisErr.message}`);
    }
  }
}
