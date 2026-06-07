import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Transaction }      from '../trades/entities/transaction.entity';
import { Artwork }          from '../artworks/entities/artwork.entity';
import { PortfolioHolding } from '../portfolio/entities/portfolio-holding.entity';

// ── Event pipeline (Chain → RabbitMQ → DB) ────────────────────────────────────
import { IndexerService }             from './indexer/indexer.service';
import { ProducerService }            from './indexer/producer.service';
import { RabbitMQBlockchainConsumer } from './consumers/rabbitmq.consumer';
import { BlockchainEventConsumer }    from './consumers/event.consumer';
import { OrderMatchConsumer }         from './consumers/order-match.consumer';

// GatewayModule exported EventsGateway — OrderMatchConsumer needs it for WS broadcast
import { GatewayModule }             from '../gateway/gateway.module';

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
    GatewayModule,   // provides EventsGateway for OrderMatchConsumer WS broadcast
  ],
  providers: [
    ProducerService,
    IndexerService,
    RabbitMQBlockchainConsumer,
    BlockchainEventConsumer,
    OrderMatchConsumer,   // Rust order-matcher result consumer
  ],
  exports: [
    ProducerService,
    IndexerService,
    BlockchainEventConsumer,
    OrderMatchConsumer,
  ],
})
export class BlockchainModule {}
