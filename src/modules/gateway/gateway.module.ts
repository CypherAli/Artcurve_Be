import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PriceGateway }  from './price.gateway';
import { EventsGateway } from './events.gateway';

// ─────────────────────────────────────────────────────────────────────────────
//  GatewayModule
//
//  Chứa tất cả WebSocket Gateways:
//    - PriceGateway  (/prices) — cũ, không auth, subscribe Redis price updates
//    - EventsGateway (/events) — mới, JWT bắt buộc, trade_updated broadcast
//
//  JwtModule cần thiết vì Web3AuthGuard inject JwtService.
//  RedisModule @Global() → RedisService available mà không cần import.
// ─────────────────────────────────────────────────────────────────────────────

@Module({
  imports: [
    JwtModule.registerAsync({
      imports:    [ConfigModule],
      inject:     [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret:      config.getOrThrow<string>('JWT_SECRET'),
        signOptions: { expiresIn: config.get('JWT_EXPIRES_IN', '7d') },
      }),
    }),
  ],
  providers: [PriceGateway, EventsGateway],
  exports:   [PriceGateway, EventsGateway],
})
export class GatewayModule {}
