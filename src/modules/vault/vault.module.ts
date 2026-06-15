import { Module } from '@nestjs/common';
import { VaultController } from './vault.controller';
import { VaultService } from './vault.service';

// ─────────────────────────────────────────────────────────────────────────────
//  VaultModule
//
//  Aggregated portfolio view cho /vault page.
//  Dùng DataSource (raw SQL) để query across portfolio_holdings, transactions,
//  artworks — không cần TypeOrmModule.forFeature vì không inject Repository.
// ─────────────────────────────────────────────────────────────────────────────

@Module({
  controllers: [VaultController],
  providers: [VaultService],
  exports: [VaultService],
})
export class VaultModule {}
