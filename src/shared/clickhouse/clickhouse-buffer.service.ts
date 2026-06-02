import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ClickHouseService, TradeInsertRow } from './clickhouse.service';

/**
 * ClickHouseBufferService — giai quyet van de "Too many parts"
 *
 * Van de:
 *   Consumer xu ly 1 message/lan -> goi insertTrade() 1 lan
 *   1000 trades/giay = 1000 HTTP requests/giay den ClickHouse
 *   Moi request tao 1 data part moi tren disk
 *   ClickHouse crash: "Too many parts (300). Merges are processing
 *   significantly slower than inserts."
 *
 * Giai phap: Client-side buffer voi 2 trigger flush:
 *   1. SIZE  trigger: buffer >= BATCH_SIZE (100) -> flush ngay
 *   2. TIME  trigger: max FLUSH_INTERVAL_MS (5 giay) -> flush du chua day
 *
 * Consumer chi goi: bufferService.add(trade)
 * Buffer tu dong gom va gui batch lon den ClickHouse
 *
 * Node.js la single-threaded -> khong can mutex cho array operations
 */
@Injectable()
export class ClickHouseBufferService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ClickHouseBufferService.name);

  // Tham so toi uu cho ClickHouse:
  // - BATCH_SIZE: 100-1000 rows/batch la ideal
  // - FLUSH_INTERVAL: 5 giay dam bao latency thap ngay ca khi traffic that
  private readonly BATCH_SIZE       = 100;
  private readonly FLUSH_INTERVAL_MS = 5_000; // 5 giay

  private buffer: TradeInsertRow[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private isFlushing = false;
  private pendingFlush = false;

  constructor(private readonly clickHouseService: ClickHouseService) {}

  onModuleInit(): void {
    this.startTimer();
    this.logger.log(
      `Buffer started: batch=${this.BATCH_SIZE} rows, interval=${this.FLUSH_INTERVAL_MS / 1000}s`,
    );
  }

  /**
   * Consumer goi ham nay thay vi goi insertTrade() truc tiep.
   * Ham nay DONG BO (O(1)) — khong await, khong block RabbitMQ processing.
   */
  add(trade: TradeInsertRow): void {
    this.buffer.push(trade);

    // Size trigger: du BATCH_SIZE -> flush ngay
    if (this.buffer.length >= this.BATCH_SIZE) {
      this.logger.debug(`Buffer full (${this.buffer.length}), triggering flush`);
      // Dung setImmediate de khong block RabbitMQ ack hien tai
      setImmediate(() => this.flush());
    }
  }

  /**
   * Drain buffer va gui batch den ClickHouse.
   *
   * Dung co che "swap buffer" de tranh race condition:
   *   1. Swap: lay toan bo buffer hien tai ra (atomic trong Node.js)
   *   2. Reset buffer ve rong ngay lap tuc
   *   3. New trades den tiep tuc vao buffer moi trong khi batch cu dang gui
   *   4. insert() batch cu -> khong block producer
   */
  async flush(): Promise<void> {
    // Neu dang flush roi, danh dau pendingFlush de flush lai sau
    if (this.isFlushing) {
      this.pendingFlush = true;
      return;
    }

    if (this.buffer.length === 0) return;

    // Atomic swap (Node.js single-threaded, khong can lock)
    const batch = this.buffer;
    this.buffer = [];         // Buffer moi, san sang nhan trade tiep theo
    this.isFlushing = true;

    try {
      await this.clickHouseService.insertTrades(batch);
      this.logger.log(`[CH Buffer] Flushed ${batch.length} trades`);
    } catch (err) {
      this.logger.error(`[CH Buffer] Flush failed: ${err.message}`, err.stack);
      // Tra trades that bai lai buffer de thu lan sau
      // (dat len dau buffer de giu thu tu thoi gian)
      this.buffer = [...batch, ...this.buffer];
    } finally {
      this.isFlushing = false;

      // Neu co pending flush trong khi dang xu ly -> chay ngay
      if (this.pendingFlush) {
        this.pendingFlush = false;
        setImmediate(() => this.flush());
      }
    }
  }

  /**
   * App shutdown: flush tat ca trade con lai trong buffer.
   * Dam bao khong mat du lieu khi deploy moi hoac restart.
   */
  async onModuleDestroy(): Promise<void> {
    this.logger.log('[CH Buffer] Shutdown: flushing remaining trades...');
    this.stopTimer();

    // Doi flush hien tai hoan thanh neu co
    if (this.isFlushing) {
      await new Promise<void>((resolve) => {
        const check = setInterval(() => {
          if (!this.isFlushing) { clearInterval(check); resolve(); }
        }, 100);
      });
    }

    await this.flush();
    this.logger.log('[CH Buffer] Shutdown flush complete');
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private startTimer(): void {
    this.flushTimer = setInterval(async () => {
      if (this.buffer.length > 0) {
        this.logger.debug(`[CH Buffer] Time trigger: flushing ${this.buffer.length} trades`);
        await this.flush();
      }
    }, this.FLUSH_INTERVAL_MS);
  }

  private stopTimer(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  /** Trang thai hien tai — dung cho health check */
  getStatus(): { buffered: number; isFlushing: boolean } {
    return { buffered: this.buffer.length, isFlushing: this.isFlushing };
  }
}
