import * as Sentry from '@sentry/node';
import { Logger } from '@nestjs/common';

// ─────────────────────────────────────────────────────────────────────────────
//  Sentry observability — error tracking cho production.
//
//  Init chỉ khi có SENTRY_DSN (không cấu hình → no-op, app chạy bình thường).
//  Gọi initSentry() SỚM trong bootstrap (trước khi tạo app) để bắt cả lỗi startup.
// ─────────────────────────────────────────────────────────────────────────────

const logger = new Logger('Sentry');
let enabled = false;

export function initSentry(dsn: string | undefined, environment: string): boolean {
  if (!dsn) {
    logger.log('SENTRY_DSN không cấu hình — error tracking tắt');
    return false;
  }
  try {
    Sentry.init({
      dsn,
      environment,
      // 10% transaction sampling — đủ để theo dõi performance mà không tốn quota
      tracesSampleRate: environment === 'production' ? 0.1 : 0,
      // Không gửi PII (IP/cookies) mặc định — bật thủ công nếu cần
      sendDefaultPii: false,
    });
    enabled = true;
    logger.log(`Sentry initialized (env=${environment})`);
    return true;
  } catch (err) {
    logger.warn(`Sentry init failed: ${(err as Error).message}`);
    return false;
  }
}

export function isSentryEnabled(): boolean {
  return enabled;
}

/** Gửi exception lên Sentry kèm context request. No-op nếu chưa init. */
export function captureException(
  exception: unknown,
  context?: Record<string, unknown>,
): void {
  if (!enabled) return;
  try {
    Sentry.withScope((scope) => {
      if (context) scope.setContext('request', context);
      Sentry.captureException(exception);
    });
  } catch {
    /* observability không bao giờ được làm hỏng request flow */
  }
}

export async function closeSentry(timeoutMs = 2000): Promise<void> {
  if (!enabled) return;
  try {
    await Sentry.close(timeoutMs);
  } catch {
    /* ignore */
  }
}
