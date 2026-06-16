import { ConsoleLogger, LogLevel } from '@nestjs/common';

// ─────────────────────────────────────────────────────────────────────────────
//  JsonLogger — structured logging (1 dòng JSON / log) cho production.
//
//  Log dạng text khó parse ở log aggregator (Datadog/Loki/CloudWatch). JSON cho
//  phép filter theo level/context, gắn correlation, alert chính xác. Ở dev vẫn
//  dùng ConsoleLogger màu mè cho dễ đọc.
// ─────────────────────────────────────────────────────────────────────────────

export class JsonLogger extends ConsoleLogger {
  private emit(level: LogLevel, message: unknown, context?: string): void {
    const line = JSON.stringify({
      ts:      new Date().toISOString(),
      level,
      context: context ?? this.context ?? 'App',
      message: typeof message === 'string' ? message : JSON.stringify(message),
    });
    // stdout cho log thường, stderr cho error/warn — đúng quy ước 12-factor
    if (level === 'error' || level === 'warn') process.stderr.write(line + '\n');
    else process.stdout.write(line + '\n');
  }

  log(message: unknown, context?: string): void     { this.emit('log', message, context); }
  error(message: unknown, stackOrCtx?: string, context?: string): void {
    this.emit('error', message, context ?? stackOrCtx);
    if (stackOrCtx && context) process.stderr.write(stackOrCtx + '\n');
  }
  warn(message: unknown, context?: string): void     { this.emit('warn', message, context); }
  debug(message: unknown, context?: string): void    { this.emit('debug', message, context); }
  verbose(message: unknown, context?: string): void  { this.emit('verbose', message, context); }
}
