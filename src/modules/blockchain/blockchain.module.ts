import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Transaction }      from '../trades/entities/transaction.entity';
import { Artwork }          from '../artworks/entities/artwork.entity';
import { PortfolioHolding } from '../portfolio/entities/portfolio-holding.entity';

// ── Event pipeline (Chain → RabbitMQ → DB) ────────────────────────────────────
import { IndexerService }             from './indexer/indexer.service';       // viem watcher + catch-up
import { ProducerService }            from './indexer/producer.service';      // RabbitMQ publisher
import { RabbitMQBlockchainConsumer } from './consumers/rabbitmq.consumer';   // RabbitMQ subscriber
import { BlockchainEventConsumer }    from './consumers/event.consumer';      // event processor → DB/Redis/CH

// ─────────────────────────────────────────────────────────────────────────────
//  BlockchainModule  —  Blockchain Event Pipeline
//
//  Full pipeline đã được gộp vào một module duy nhất:
//
//    [ Base L2 ] ──(viem watchContractEvent)──▶ IndexerService (indexer/)
//                                                      │
//                                               ProducerService (indexer/) ──▶ [ RabbitMQ ]
//                                                                                      │
//                                              RabbitMQBlockchainConsumer (consumers/) ◀─┘
//                                                      │
//                                              BlockchainEventConsumer (consumers/)
//                                                      │
//                                    ┌─────────────────┼─────────────────┐
//                                 [ PostgreSQL ]   [ Redis ]   [ ClickHouse ]
//
//  @Global() — ProducerService, IndexerService, BlockchainEventConsumer
//               có thể được inject bất kỳ đâu mà không cần import lại.
//
//  Dependencies (đều là @Global, không cần import lại):
//    - ConfigModule     → RPC_URL, RabbitMQ URLs, Contract addresses
//    - InfraRedisModule → INFRA_REDIS_CLIENT (checkpoint: indexer:last_block)
//    - RedisModule      → RedisService (price cache, pub/sub)
//    - ClickHouseModule → ClickHouseService, ClickHouseBufferService
// ─────────────────────────────────────────────────────────────────────────────

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([Transaction, Artwork, PortfolioHolding]),
  ],
  providers: [
    ProducerService,               // RabbitMQ connection + event publishing
    IndexerService,                // viem real-time watcher + block catch-up
    RabbitMQBlockchainConsumer,    // RabbitMQ subscriber → BlockchainEventConsumer
    BlockchainEventConsumer,       // Writes to PostgreSQL + Redis + ClickHouse
  ],
  exports: [
    ProducerService,
    IndexerService,
    BlockchainEventConsumer,
  ],
})
export class BlockchainModule {}
