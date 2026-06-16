import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { captureException } from '../observability/sentry.util';

// ─────────────────────────────────────────────────────────────────────────────
//  AllExceptionsFilter  (src/common/filters/)
//
//  Global exception filter — bắt MỌI lỗi (HttpException + Error thường)
//  và chuẩn hóa về 1 format JSON duy nhất:
//
//  HTTP response body:
//  {
//    "statusCode": 404,
//    "timestamp":  "2024-01-01T00:00:00.000Z",
//    "path":       "/api/v1/artworks/not-found",
//    "method":     "GET",
//    "message":    "Artwork không tồn tại"
//  }
//
//  Lợi ích:
//    - Frontend không bao giờ nhận raw Express error
//    - Mọi lỗi đều có timestamp để debug
//    - 5xx errors được log đầy đủ stack trace (4xx chỉ log warn)
//    - Thông tin nhạy cảm (stack trace) KHÔNG được gửi ra ngoài
//
//  Cách apply trong main.ts:
//    app.useGlobalFilters(new AllExceptionsFilter());
// ─────────────────────────────────────────────────────────────────────────────

export interface ErrorResponseBody {
  statusCode: number;
  timestamp:  string;
  path:       string;
  method:     string;
  message:    string | string[];
  error_id?:  string;   // chỉ có ở 5xx — dùng để tra cứu trong Sentry/logs
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx      = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request  = ctx.getRequest<Request>();

    const { status, message } = this.resolveException(exception);

    // 5xx → gắn error_id để client báo support, đồng thời log + gửi Sentry cùng id
    const errorId = status >= 500 ? randomUUID() : undefined;

    const body: ErrorResponseBody = {
      statusCode: status,
      timestamp:  new Date().toISOString(),
      path:       request.url,
      method:     request.method,
      message,
      ...(errorId ? { error_id: errorId } : {}),
    };

    // 5xx → log error với stack trace (chỉ trên server, không gửi ra client)
    // 4xx → log warn nhẹ hơn
    if (status >= 500) {
      this.logger.error(
        `[${request.method}] ${request.url} → ${status} (error_id=${errorId})`,
        exception instanceof Error ? exception.stack : String(exception),
      );
      captureException(exception, {
        error_id:    errorId,
        method:      request.method,
        path:        request.url,
        status_code: status,
      });
    } else {
      this.logger.warn(`[${request.method}] ${request.url} → ${status}: ${JSON.stringify(message)}`);
    }

    response.status(status).json(body);
  }

  // ── Helper ────────────────────────────────────────────────────────────────

  private resolveException(exception: unknown): { status: number; message: string | string[] } {
    if (exception instanceof HttpException) {
      const status  = exception.getStatus();
      const resBody = exception.getResponse();

      // NestJS ValidationPipe trả về { message: string[], error: string, statusCode }
      // NestJS HttpException đơn giản trả về string
      if (typeof resBody === 'object' && resBody !== null) {
        const body = resBody as Record<string, any>;
        return {
          status,
          message: body['message'] ?? exception.message,
        };
      }

      return { status, message: String(resBody) };
    }

    // Lỗi không phải HttpException → 500 Internal Server Error
    // KHÔNG expose message gốc ra ngoài (có thể chứa thông tin nhạy cảm)
    return {
      status:  HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error. Vui lòng thử lại sau.',
    };
  }
}
