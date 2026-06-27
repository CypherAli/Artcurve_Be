import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Inject,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createPublicClient,
  http,
  webSocket,
  fallback,
  type Address,
  type Log,
  parseAbiItem,
} from 'viem';
import { base, baseSepolia } from 'viem/chains';
import Redis from 'ioredis';
import { ART_FACTORY_ABI }       from '../../../common/abis/ArtFactory.abi';
import { BONDING_CURVE_AMM_ABI } from '../../../common/abis/BondingCurveAMM.abi';
import { INFRA_REDIS_CLIENT }    from '../../../shared/redis/redis-client.module';
import {
  ProducerService,
  type ArtworkCreatedPayload,
  type TradeExecutedPayload,
  type GraduatedPayload,
} from './producer.service';

// ─────────────────────────────────────────────────────────────────────────────
//  IndexerService
//
//  Hai chế độ hoạt động song song:
//
//  [A] CATCH-UP (onModuleInit)
//      Đọc Redis key `indexer:last_block`.
//      Nếu gap > 0: gọi getLogs() theo chunk 2k blocks
//      → process logs đã bị lỡ khi server offline.
//      Cập nhật `indexer:last_block` sau mỗi chunk.
//
//  [B] REAL-TIME (watchContractEvent)
//      Lắng nghe events từ block hiện tại trở đi.
//      Sau mỗi event: cập nhật `indexer:last_block`.
//
//  Thiết kế chống mất data:
//    - `indexer:last_block` lưu block đã xử lý cuối cùng
//    - Catchup re-runs nếu server crash giữa chừng
//    - getLogs dùng theo chunk để tránh RPC timeout
//    - Logs được sort theo (blockNumber, logIndex) để đảm bảo thứ tự
//    - getLogs chỉ chạy 1 lần; watchContractEvent không trùng block
// ─────────────────────────────────────────────────────────────────────────────

const LAST_BLOCK_KEY     = 'indexer:last_block';
const CATCHUP_CHUNK_SIZE = 2_000n;          // blocks per getLogs request
const DEFAULT_LOOKBACK   = 1_000n;          // blocks lookback khi chưa có stored block (~33 phút Base)

// Chain map: chainId → viem chain object
const CHAIN_MAP: Record<number, any> = { 8453: base, 84532: baseSepolia };

// Parsed ABI items cho getLogs (cần parseAbiItem để type-safe)
const ARTWORK_CREATED_EVENT = parseAbiItem(
  'event ArtworkCreated(address indexed artworkAmm, address indexed creator, string metadataCID, uint256 indexed artworkId, uint256 targetCap)',
);
const TRADE_EVENT = parseAbiItem(
  'event Trade(address indexed user, uint256 indexed artworkId_, bool isBuy, uint256 shareAmount, uint256 ethAmount, uint256 price)',
);
const GRADUATED_EVENT = parseAbiItem(
  'event GraduatedToDEX(uint256 indexed artworkId_, uint256 totalLiquidity)',
);

@Injectable()
export class IndexerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IndexerService.name);

  private client: any; // ReturnType<typeof createPublicClient>
  private factoryAddress: Address | null = null;

  private unwatchArtworkCreated: (() => void) | null = null;
  private unwatchTrade:          (() => void) | null = null;
  private unwatchGraduated:      (() => void) | null = null;

  constructor(
    private readonly config:   ConfigService,
    private readonly producer: ProducerService,
    @Inject(INFRA_REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  async onModuleInit(): Promise<void> {
    this.client         = this.buildClient();
    this.factoryAddress = this.resolveFactoryAddress();

    // Non-blocking: do not await — RPC + Redis may be unavailable in dev
    // Catches failures gracefully so app still boots without blockchain infra
    this.startAsync().catch(err =>
      this.logger.warn(`[Indexer] Startup skipped (infra unavailable): ${err.message}`),
    );
  }

  private async startAsync(): Promise<void> {
    await this.catchUp();
    this.watchArtworkCreated();
    this.watchTrade();
    this.watchGraduated();
    this.logger.log('[Indexer] Started — catch-up done, real-time watchers active');
  }

  onModuleDestroy(): void {
    this.unwatchArtworkCreated?.();
    this.unwatchTrade?.();
    this.unwatchGraduated?.();
    this.logger.log('[Indexer] Stopped — all watchers unsubscribed');
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  [A] CATCH-UP
  // ══════════════════════════════════════════════════════════════════════════

  private async catchUp(): Promise<void> {
    let currentBlock: bigint;
    try {
      currentBlock = await this.client.getBlockNumber();
    } catch (err) {
      this.logger.error(`[Catchup] Cannot get current block: ${err.message}`);
      return; // Không fail app — tiếp tục với real-time watcher
    }

    const stored = await this.redis.get(LAST_BLOCK_KEY);
    const fromBlock = stored
      ? BigInt(stored) + 1n                    // tiếp tục từ block tiếp theo
      : currentBlock - DEFAULT_LOOKBACK;       // không có stored → lookback 1k blocks

    if (fromBlock > currentBlock) {
      this.logger.log('[Catchup] Already up-to-date. Skipping.');
      return;
    }

    const gap = currentBlock - fromBlock + 1n;
    this.logger.log(`[Catchup] Syncing ${gap} blocks: #${fromBlock} → #${currentBlock}`);

    // Chia thành chunk để tránh RPC timeout (mỗi RPC thường giới hạn 2k–10k blocks)
    let cursor = fromBlock;
    while (cursor <= currentBlock) {
      const chunkEnd = cursor + CATCHUP_CHUNK_SIZE - 1n < currentBlock
        ? cursor + CATCHUP_CHUNK_SIZE - 1n
        : currentBlock;

      await this.processCatchupChunk(cursor, chunkEnd);
      cursor = chunkEnd + 1n;
    }

    await this.redis.set(LAST_BLOCK_KEY, currentBlock.toString());
    this.logger.log(`[Catchup] Complete. Last block: ${currentBlock}`);
  }

  private async processCatchupChunk(fromBlock: bigint, toBlock: bigint): Promise<void> {
    this.logger.debug(`[Catchup] Chunk #${fromBlock}–#${toBlock}`);

    try {
      // Fetch tất cả event types song song
      const [artworkLogs, tradeLogs, graduatedLogs] = await Promise.all([
        this.factoryAddress
          ? this.client.getLogs({ address: this.factoryAddress, event: ARTWORK_CREATED_EVENT, fromBlock, toBlock })
          : Promise.resolve([]),
        this.client.getLogs({ event: TRADE_EVENT,     fromBlock, toBlock }),
        this.client.getLogs({ event: GRADUATED_EVENT, fromBlock, toBlock }),
      ]);

      // Sort tất cả logs theo block + logIndex để đảm bảo thứ tự nhân quả
      const tagged = [
        ...artworkLogs.map((l: any) => ({ ...l, _type: 'artwork'   })),
        ...tradeLogs.map((l: any)   => ({ ...l, _type: 'trade'     })),
        ...graduatedLogs.map((l: any) => ({ ...l, _type: 'graduated' })),
      ].sort((a, b) => {
        const blockDiff = Number(a.blockNumber - b.blockNumber);
        if (blockDiff !== 0) return blockDiff;
        return Number((a.logIndex ?? 0n) - (b.logIndex ?? 0n));
      });

      for (const log of tagged) {
        if (log._type === 'artwork')   await this.handleArtworkCreated(log);
        if (log._type === 'trade')     await this.handleTrade(log);
        if (log._type === 'graduated') await this.handleGraduated(log);
      }

      // Cập nhật sau mỗi chunk để checkpoint tiến độ
      await this.redis.set(LAST_BLOCK_KEY, toBlock.toString());

    } catch (err) {
      this.logger.error(`[Catchup] Chunk ${fromBlock}–${toBlock} failed: ${err.message}`);
      // Tiếp tục chunk tiếp theo thay vì crash — partial catchup vẫn tốt hơn không có gì
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  [B] REAL-TIME WATCHERS
  // ══════════════════════════════════════════════════════════════════════════

  private watchArtworkCreated(): void {
    if (!this.factoryAddress) {
      this.logger.warn('[Indexer] ART_FACTORY_ADDRESS not set — ArtworkCreated watcher disabled');
      return;
    }

    this.unwatchArtworkCreated = this.client.watchContractEvent({
      address:   this.factoryAddress,
      abi:       ART_FACTORY_ABI,
      eventName: 'ArtworkCreated',
      onLogs:    async (logs: any[]) => {
        for (const log of logs) {
          try {
            await this.handleArtworkCreated(log);
            await this.updateLastBlock(log.blockNumber);
          } catch (err) {
            this.logger.error(`[ArtworkCreated] Failed at block ${log.blockNumber}, NOT advancing checkpoint: ${err.message}`);
          }
        }
      },
      onError: (err: Error) => this.logger.error(`ArtworkCreated watcher: ${err.message}`),
    });

    this.logger.log(`[Indexer] Watching ArtworkCreated @ ${this.factoryAddress}`);
  }

  private watchTrade(): void {
    this.unwatchTrade = this.client.watchContractEvent({
      abi:       BONDING_CURVE_AMM_ABI,
      eventName: 'Trade',
      onLogs:    async (logs: any[]) => {
        for (const log of logs) {
          try {
            await this.handleTrade(log);
            await this.updateLastBlock(log.blockNumber);
          } catch (err) {
            this.logger.error(`[Trade] Failed to process event at block ${log.blockNumber}, NOT advancing checkpoint: ${err.message}`);
          }
        }
      },
      onError: (err: Error) => this.logger.error(`Trade watcher: ${err.message}`),
    });
    this.logger.log('[Indexer] Watching Trade (all AMM clones)');
  }

  private watchGraduated(): void {
    this.unwatchGraduated = this.client.watchContractEvent({
      abi:       BONDING_CURVE_AMM_ABI,
      eventName: 'GraduatedToDEX',
      onLogs:    async (logs: any[]) => {
        for (const log of logs) {
          try {
            await this.handleGraduated(log);
            await this.updateLastBlock(log.blockNumber);
          } catch (err) {
            this.logger.error(`[GraduatedToDEX] Failed at block ${log.blockNumber}, NOT advancing checkpoint: ${err.message}`);
          }
        }
      },
      onError: (err: Error) => this.logger.error(`GraduatedToDEX watcher: ${err.message}`),
    });
    this.logger.log('[Indexer] Watching GraduatedToDEX (all AMM clones)');
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  EVENT HANDLERS
  // ══════════════════════════════════════════════════════════════════════════

  private async handleArtworkCreated(log: any): Promise<void> {
    try {
      const { args, transactionHash, blockNumber, address } = log;
      if (!args) return;

      const timestamp = await this.getBlockTimestamp(blockNumber);
      const payload: ArtworkCreatedPayload = {
        tx_hash:      transactionHash   ?? '',
        amm_address:  String(args.artworkAmm ?? address ?? '').toLowerCase(),
        creator:      String(args.creator    ?? '').toLowerCase(),
        metadata_cid: String(args.metadataCID ?? ''),
        artwork_id:   String(args.artworkId  ?? args.artworkId_ ?? 0n),
        target_cap:   String(args.targetCap  ?? 0n),
        block_number: String(blockNumber ?? 0n),
        timestamp:    String(timestamp),
      };

      await this.producer.publishArtworkCreated(payload);
      this.logger.log(`[ArtworkCreated] id=${payload.artwork_id} tx=${payload.tx_hash}`);
    } catch (err) {
      this.logger.error(`handleArtworkCreated: ${err.message}`);
      throw err;
    }
  }

  private async handleTrade(log: any): Promise<void> {
    try {
      const { args, transactionHash, blockNumber, address } = log;
      if (!args) return;

      const timestamp = await this.getBlockTimestamp(blockNumber);
      const payload: TradeExecutedPayload = {
        tx_hash:         transactionHash ?? '',
        amm_address:     String(address ?? '').toLowerCase(),
        user_wallet:     String(args.user ?? '').toLowerCase(),
        artwork_id:      String(args.artworkId_ ?? 0n),
        is_buy:          Boolean(args.isBuy),
        share_amount:    String(args.shareAmount ?? 0n),
        eth_amount:      String(args.ethAmount   ?? 0n),
        price_per_share: String(args.price       ?? 0n),
        block_number:    String(blockNumber ?? 0n),
        timestamp:       String(timestamp),
      };

      await this.producer.publishTradeExecuted(payload);
      this.logger.log(
        `[Trade] id=${payload.artwork_id} isBuy=${payload.is_buy} shares=${payload.share_amount}`,
      );
    } catch (err) {
      this.logger.error(`handleTrade: ${err.message}`);
      throw err;
    }
  }

  private async handleGraduated(log: any): Promise<void> {
    try {
      const { args, transactionHash, blockNumber, address } = log;
      if (!args) return;

      const timestamp = await this.getBlockTimestamp(blockNumber);
      const payload: GraduatedPayload = {
        tx_hash:         transactionHash ?? '',
        amm_address:     String(address ?? '').toLowerCase(),
        artwork_id:      String(args.artworkId_ ?? 0n),
        total_liquidity: String(args.totalLiquidity ?? 0n),
        block_number:    String(blockNumber ?? 0n),
        timestamp:       String(timestamp),
      };

      await this.producer.publishGraduated(payload);
      this.logger.log(`[GraduatedToDEX] id=${payload.artwork_id} liquidity=${payload.total_liquidity}`);
    } catch (err) {
      this.logger.error(`handleGraduated: ${err.message}`);
      throw err;
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  HELPERS
  // ══════════════════════════════════════════════════════════════════════════

  private buildClient(): any {
    const rpcUrl  = this.config.get<string>('RPC_URL',    'https://mainnet.base.org');
    const wsUrl   = this.config.get<string>('WS_RPC_URL', '');
    const chainId = this.config.get<number>('CHAIN_ID',   8453);
    const chain   = CHAIN_MAP[chainId] ?? base;

    this.logger.log(`[Indexer] RPC: ${rpcUrl} (chainId=${chainId})`);

    // WebSocket transport: watchContractEvent uses eth_subscribe (no polling, no filter expiry)
    // HTTP fallback: used for getLogs catch-up and if WS unavailable
    const transport = wsUrl
      ? fallback([
          webSocket(wsUrl, { retryCount: 5, retryDelay: 2_000 }),
          http(rpcUrl,     { retryCount: 5, retryDelay: 2_000, timeout: 30_000 }),
        ])
      : http(rpcUrl, { retryCount: 5, retryDelay: 2_000, timeout: 30_000 });

    if (wsUrl) this.logger.log(`[Indexer] WebSocket transport active: ${wsUrl.split('/v2/')[0]}/v2/***`);

    return createPublicClient({ chain, transport });
  }

  private resolveFactoryAddress(): Address | null {
    const addr = this.config.get<string>('ART_FACTORY_ADDRESS', '');
    if (!addr || addr === '0x0000000000000000000000000000000000000000') return null;
    return addr as Address;
  }

  private async getBlockTimestamp(blockNumber: bigint): Promise<number> {
    try {
      const block = await this.client.getBlock({ blockNumber });
      return Number(block.timestamp);
    } catch {
      return Math.floor(Date.now() / 1000); // Fallback
    }
  }

  private async updateLastBlock(blockNumber: bigint | undefined): Promise<void> {
    if (blockNumber == null) return;
    const stored = await this.redis.get(LAST_BLOCK_KEY);
    if (!stored || BigInt(stored) < blockNumber) {
      await this.redis.set(LAST_BLOCK_KEY, blockNumber.toString());
    }
  }
}
