import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TradesController } from './trades.controller';
import { TradesService }    from './trades.service';
import { InfraClickHouseModule } from '../../shared/clickhouse/clickhouse-client.module';
import { Transaction } from './entities/transaction.entity';
import { TransactionRepository } from './repositories/transaction.repository';

// ─────────────────────────────────────────────────────────────────────────────
//  TradesModule  (src/modules/trades/)
//
//  Module xử lý API lịch sử giao dịch và dữ liệu chart:
//    GET /trades/:artworkId/ohlcv       — OHLCV cho chart
//    GET /trades/:artworkId/history     — Lịch sử raw
//    GET /trades/:artworkId/volume      — Volume 24h
//    GET /trades/leaderboard            — Top by volume
//
//  Dependencies:
//    InfraClickHouseModule — cung cấp InfraClickHouseService cho TradesService
//
//  CHỈ ĐỌC — không write trực tiếp vào DB.
//  Write flow: Blockchain → RabbitMQ → BlockchainEventConsumer → ClickHouse.
// ─────────────────────────────────────────────────────────────────────────────

@Module({
  imports:     [InfraClickHouseModule, TypeOrmModule.forFeature([Transaction])],
  controllers: [TradesController],
  providers:   [TradesService, TransactionRepository],
  exports:     [TradesService, TransactionRepository],
})
export class TradesModule {}
