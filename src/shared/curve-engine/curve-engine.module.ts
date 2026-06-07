import { Global, Module } from '@nestjs/common';
import { CurveEngineService } from './curve-engine.service';

@Global()
@Module({
  providers: [CurveEngineService],
  exports:   [CurveEngineService],
})
export class CurveEngineModule {}
