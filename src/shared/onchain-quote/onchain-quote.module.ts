import { Module, Global } from '@nestjs/common';
import { OnchainQuoteService } from './onchain-quote.service';

@Global()
@Module({
  providers: [OnchainQuoteService],
  exports: [OnchainQuoteService],
})
export class OnchainQuoteModule {}
