import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import * as path from 'path';

// ── Proto types ───────────────────────────────────────────────────────────────
export type CurveTypePb = 'LINEAR' | 'QUADRATIC' | 'EXPONENTIAL';

export interface CurveParams {
  curve_type:   CurveTypePb;
  init_price:   string;   // ETH string, e.g. "0.00100000"
  slope:        string;   // curve coefficient
  total_supply: string;   // graduation threshold
}

export interface SpotPriceRequest  { params: CurveParams; current_supply: string }
export interface SpotPriceResponse { price: string; market_cap: string }

export interface TradeRequest  { params: CurveParams; current_supply: string; amount: string }
export interface TradeResponse {
  eth_amount:       string;
  price_per_token:  string;
  new_supply:       string;
  new_spot_price:   string;
  would_graduate:   boolean;
}

export interface PriceCurveRequest  { params: CurveParams; points: number }
export interface PricePoint         { supply: string; price: string }
export interface PriceCurveResponse { points: PricePoint[] }

// ── gRPC service client stubs ─────────────────────────────────────────────────
interface CurveEngineClient extends grpc.Client {
  GetSpotPrice(req: SpotPriceRequest,  cb: grpc.requestCallback<SpotPriceResponse>): void;
  GetBuyCost(req: TradeRequest,        cb: grpc.requestCallback<TradeResponse>): void;
  GetSellReturn(req: TradeRequest,     cb: grpc.requestCallback<TradeResponse>): void;
  GetPriceCurve(req: PriceCurveRequest, cb: grpc.requestCallback<PriceCurveResponse>): void;
}

// Helper: promisify a grpc callback call
function call<TReq, TRes>(
  client: CurveEngineClient,
  method: (req: TReq, cb: grpc.requestCallback<TRes>) => void,
  req: TReq,
): Promise<TRes> {
  return new Promise((resolve, reject) => {
    method.call(client, req, (err, res) => {
      if (err || !res) return reject(err ?? new Error('empty response'));
      resolve(res);
    });
  });
}

@Injectable()
export class CurveEngineService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CurveEngineService.name);
  private client: CurveEngineClient | null = null;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const url = this.config.get<string>('CURVE_ENGINE_URL') ?? 'localhost:50051';

    const packageDef = protoLoader.loadSync(
      path.join(__dirname, 'curve.proto'),
      { keepCase: true, longs: String, enums: String, defaults: true, oneofs: true },
    );
    const proto = grpc.loadPackageDefinition(packageDef) as Record<string, unknown>;
    const CurveEngineStub = (proto['curve'] as Record<string, unknown>)['CurveEngine'] as new (
      address: string,
      credentials: grpc.ChannelCredentials,
    ) => CurveEngineClient;

    this.client = new CurveEngineStub(url, grpc.credentials.createInsecure());
    this.logger.log(`Curve Engine gRPC connected → ${url}`);
  }

  onModuleDestroy() {
    this.client?.close();
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  getSpotPrice(req: SpotPriceRequest): Promise<SpotPriceResponse> {
    this.assertClient();
    return call(this.client!, this.client!.GetSpotPrice, req);
  }

  getBuyCost(req: TradeRequest): Promise<TradeResponse> {
    this.assertClient();
    return call(this.client!, this.client!.GetBuyCost, req);
  }

  getSellReturn(req: TradeRequest): Promise<TradeResponse> {
    this.assertClient();
    return call(this.client!, this.client!.GetSellReturn, req);
  }

  getPriceCurve(req: PriceCurveRequest): Promise<PriceCurveResponse> {
    this.assertClient();
    return call(this.client!, this.client!.GetPriceCurve, req);
  }

  private assertClient() {
    if (!this.client) throw new Error('CurveEngine gRPC client not initialized');
  }
}
