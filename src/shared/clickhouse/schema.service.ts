import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { ClickHouseClient } from '@clickhouse/client';
import { Inject } from '@nestjs/common';
import { INFRA_CLICKHOUSE_CLIENT } from './clickhouse.tokens';

// ─────────────────────────────────────────────────────────────────────────────
//  ClickHouseSchemaService
//
//  Chạy schema.sql khi NestJS khởi động (onModuleInit).
//  Tất cả lệnh CREATE TABLE IF NOT EXISTS / CREATE MATERIALIZED VIEW IF NOT EXISTS
//  đều idempotent — an toàn để chạy nhiều lần.
//
//  Flow:
//    1. Đọc schema.sql từ cùng thư mục
//    2. Tách thành từng statement (phân cách bằng ';')
//    3. Execute tuần tự — thứ tự quan trọng (backing table trước MV)
//    4. Log kết quả; lỗi ném ra để fail-fast khi startup
//
//  Tại sao không dùng migration tool riêng (Flyway, Liquibase)?
//  ClickHouse không hỗ trợ DDL transactions. Schema thay đổi hiếm,
//  IF NOT EXISTS đủ an toàn cho dự án ở giai đoạn này.
// ─────────────────────────────────────────────────────────────────────────────

@Injectable()
export class ClickHouseSchemaService implements OnModuleInit {
  private readonly logger = new Logger(ClickHouseSchemaService.name);

  constructor(
    @Inject(INFRA_CLICKHOUSE_CLIENT)
    private readonly ch: ClickHouseClient,
  ) {}

  async onModuleInit(): Promise<void> {
    // Graceful degradation: nếu ClickHouse chưa chạy (dev local) thì bỏ qua
    try {
      await this.runSchema();
    } catch (err) {
      this.logger.warn(`[ClickHouse] Schema init skipped (service unavailable): ${err.message}`);
    }
  }

  async runSchema(): Promise<void> {
    this.logger.log('[ClickHouse] Running schema migration...');

    // Tạo database nếu chưa tồn tại (ClickHouse Cloud không tự tạo)
    await this.ch.exec({ query: 'CREATE DATABASE IF NOT EXISTS artcurve_analytics' });
    this.logger.log('[ClickHouse] Database artcurve_analytics ensured');

    // Đọc file schema.sql cùng thư mục với file này
    const schemaPath = join(__dirname, 'schema.sql');
    let sql: string;

    try {
      // __dirname trỏ vào dist/ sau khi build — cần copy schema.sql vào dist/
      // Nếu không tìm thấy ở dist/, thử đọc từ src/ (dev mode)
      try {
        sql = readFileSync(schemaPath, 'utf-8');
      } catch {
        const srcPath = join(process.cwd(), 'src', 'infrastructure', 'clickhouse', 'schema.sql');
        sql = readFileSync(srcPath, 'utf-8');
        this.logger.debug('[ClickHouse] Loaded schema from src/ (dev mode)');
      }
    } catch (err) {
      this.logger.error('[ClickHouse] Cannot read schema.sql', err.message);
      throw err;
    }

    // Tách statements — bỏ comment-only lines và empty statements
    const statements = sql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));

    this.logger.log(`[ClickHouse] Executing ${statements.length} DDL statements...`);

    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i];
      // Lấy tên object từ CREATE TABLE/VIEW IF NOT EXISTS <name>
      const nameMatch = stmt.match(/CREATE\s+(?:TABLE|MATERIALIZED VIEW)\s+IF\s+NOT\s+EXISTS\s+(\w+)/i);
      const objName   = nameMatch?.[1] ?? `statement_${i + 1}`;

      try {
        await this.ch.exec({ query: stmt });
        this.logger.log(`[ClickHouse] ✓ ${objName}`);
      } catch (err) {
        // Một số lỗi chấp nhận được khi MV đã tồn tại
        const msg = String(err?.message ?? err);
        if (msg.includes('already exists')) {
          this.logger.debug(`[ClickHouse] ↷ ${objName} already exists — skipped`);
        } else {
          this.logger.error(`[ClickHouse] ✗ ${objName}: ${msg}`);
          throw err; // Fail-fast — không tiếp tục nếu DDL lỗi
        }
      }
    }

    this.logger.log('[ClickHouse] Schema migration complete.');
  }
}
