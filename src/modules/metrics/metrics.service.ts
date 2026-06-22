import { Injectable } from '@nestjs/common';
import { Registry, collectDefaultMetrics, Histogram, Counter, Gauge } from 'prom-client';

@Injectable()
export class MetricsService {
  readonly registry = new Registry();

  readonly httpDuration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request duration',
    labelNames: ['method', 'route', 'status'] as const,
    buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5],
  });

  readonly httpTotal = new Counter({
    name: 'http_requests_total',
    help: 'Total HTTP requests',
    labelNames: ['method', 'route', 'status'] as const,
  });

  readonly tradesTotal = new Counter({
    name: 'artcurve_trades_total',
    help: 'Total trades executed',
    labelNames: ['side'] as const,
  });

  readonly tradeVolume = new Histogram({
    name: 'artcurve_trade_volume_eth',
    help: 'Trade volume in ETH',
    buckets: [0.001, 0.01, 0.05, 0.1, 0.5, 1, 5, 10],
  });

  readonly artworksCreated = new Counter({
    name: 'artcurve_artworks_created_total',
    help: 'Total artworks created',
  });

  readonly wsConnections = new Gauge({
    name: 'artcurve_ws_connections',
    help: 'Active WebSocket connections',
    labelNames: ['namespace'] as const,
  });

  readonly authAttempts = new Counter({
    name: 'artcurve_auth_attempts_total',
    help: 'Authentication attempts',
    labelNames: ['method', 'result'] as const,
  });

  constructor() {
    this.registry.setDefaultLabels({ app: 'artcurve-be' });
    collectDefaultMetrics({ register: this.registry });
    this.registry.registerMetric(this.httpDuration);
    this.registry.registerMetric(this.httpTotal);
    this.registry.registerMetric(this.tradesTotal);
    this.registry.registerMetric(this.tradeVolume);
    this.registry.registerMetric(this.artworksCreated);
    this.registry.registerMetric(this.wsConnections);
    this.registry.registerMetric(this.authAttempts);
  }

  observe(method: string, route: string, status: number, seconds: number): void {
    const labels = { method, route, status: String(status) };
    this.httpDuration.observe(labels, seconds);
    this.httpTotal.inc(labels);
  }

  recordTrade(side: 'buy' | 'sell', ethAmount: number): void {
    this.tradesTotal.inc({ side });
    this.tradeVolume.observe(ethAmount);
  }

  recordArtworkCreated(): void {
    this.artworksCreated.inc();
  }

  recordAuth(method: string, result: 'success' | 'failure'): void {
    this.authAttempts.inc({ method, result });
  }

  async render(): Promise<string> {
    return this.registry.metrics();
  }

  get contentType(): string {
    return this.registry.contentType;
  }
}
