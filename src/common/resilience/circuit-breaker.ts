import { Logger, ServiceUnavailableException } from '@nestjs/common';

// ─────────────────────────────────────────────────────────────────────────────
//  CircuitBreaker — fail-fast khi external service (Pinata/LiveKit/RPC) sập.
//
//  States:
//    CLOSED    — bình thường, cho request đi qua.
//    OPEN      — đã quá ngưỡng lỗi → fail ngay (không gọi service đang chết),
//                tránh xếp hàng request + cho service thời gian hồi phục.
//    HALF_OPEN — sau cooldown, thử 1 request; thành công → CLOSED, lỗi → OPEN lại.
// ─────────────────────────────────────────────────────────────────────────────

export class CircuitBreaker {
  private failures = 0;
  private openedAt = 0;
  private halfOpen = false;
  private readonly logger: Logger;

  constructor(
    private readonly name: string,
    private readonly threshold = 5,      // số lỗi liên tiếp để mở mạch
    private readonly cooldownMs = 30_000, // thời gian OPEN trước khi thử lại
  ) {
    this.logger = new Logger(`CircuitBreaker:${name}`);
  }

  async exec<T>(fn: () => Promise<T>): Promise<T> {
    if (this.isOpen()) {
      throw new ServiceUnavailableException(`${this.name} tạm thời không khả dụng (circuit open)`);
    }
    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  private isOpen(): boolean {
    if (this.openedAt === 0) return false;
    if (Date.now() - this.openedAt >= this.cooldownMs) {
      // chuyển sang HALF_OPEN: cho 1 request thử
      this.halfOpen = true;
      this.openedAt = 0;
      return false;
    }
    return true;
  }

  private onSuccess(): void {
    if (this.halfOpen) this.logger.log(`${this.name} recovered → CLOSED`);
    this.failures = 0;
    this.halfOpen = false;
  }

  private onFailure(): void {
    this.failures++;
    if (this.halfOpen || this.failures >= this.threshold) {
      this.openedAt = Date.now();
      this.halfOpen = false;
      this.logger.warn(`${this.name} OPEN sau ${this.failures} lỗi — fail-fast ${this.cooldownMs}ms`);
    }
  }
}

/** fetch kèm timeout — external call không bao giờ được treo vô hạn. */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = 20_000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
