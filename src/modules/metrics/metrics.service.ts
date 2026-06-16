import { Injectable } from '@nestjs/common';
import { Registry, collectDefaultMetrics, Histogram, Counter } from 'prom-client';

// ─────────────────────────────────────────────────────────────────────────────
//  MetricsService — Prometheus metrics cho production observability.
//  Expose qua GET /metrics (Prometheus scrape). Gồm:
//    - default Node metrics (CPU, heap, event loop lag, GC...)
//    - http_request_duration_seconds (histogram theo method/route/status)
//    - http_requests_total (counter)
// ─────────────────────────────────────────────────────────────────────────────

@Injectable()
export class MetricsService {
  readonly registry = new Registry();

  readonly httpDuration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'Thời gian xử lý HTTP request',
    labelNames: ['method', 'route', 'status'] as const,
    buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5],
  });

  readonly httpTotal = new Counter({
    name: 'http_requests_total',
    help: 'Tổng số HTTP request',
    labelNames: ['method', 'route', 'status'] as const,
  });

  constructor() {
    this.registry.setDefaultLabels({ app: 'artcurve-be' });
    collectDefaultMetrics({ register: this.registry });
    this.registry.registerMetric(this.httpDuration);
    this.registry.registerMetric(this.httpTotal);
  }

  observe(method: string, route: string, status: number, seconds: number): void {
    const labels = { method, route, status: String(status) };
    this.httpDuration.observe(labels, seconds);
    this.httpTotal.inc(labels);
  }

  async render(): Promise<string> {
    return this.registry.metrics();
  }

  get contentType(): string {
    return this.registry.contentType;
  }
}
