// ─────────────────────────────────────────────────────────────────
//  app.middleware.ts
//  Global middleware applied in main.ts / AppModule
//  • Request logger (method, path, latency, status)
//  • Correlation-ID injector (tracing)
// ─────────────────────────────────────────────────────────────────

import {
  Injectable, NestMiddleware, Logger,
} from '@nestjs/common'
import { Request, Response, NextFunction } from 'express'
import { randomUUID } from 'crypto'

// ── Request Logger Middleware ─────────────────────────────────────
@Injectable()
export class LoggerMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP')

  use(req: Request, res: Response, next: NextFunction): void {
    const { method, originalUrl } = req
    const startAt = process.hrtime()

    res.on('finish', () => {
      const { statusCode } = res
      const [sec, ns]  = process.hrtime(startAt)
      const latencyMs  = (sec * 1_000 + ns / 1_000_000).toFixed(1)
      const color      = statusCode >= 500 ? '🔴' : statusCode >= 400 ? '🟡' : '🟢'

      this.logger.log(
        `${color} ${method} ${originalUrl} ${statusCode} — ${latencyMs}ms`,
      )
    })

    next()
  }
}

// ── Correlation-ID Middleware ─────────────────────────────────────
// Injects X-Correlation-ID header so all logs for one request share an ID.
// Frontend can pass its own ID; if absent, server generates one.
@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const id = (req.headers['x-correlation-id'] as string) ?? randomUUID()
    req['correlationId'] = id
    res.setHeader('X-Correlation-ID', id)
    next()
  }
}
