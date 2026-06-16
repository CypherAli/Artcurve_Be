import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { MetricsService } from '../../modules/metrics/metrics.service';

// Ghi http_request_duration + counter cho mỗi request HTTP.
// Dùng route template (req.route.path) làm label → tránh high-cardinality từ id động.
@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const start = process.hrtime.bigint();
    const http = context.switchToHttp();
    const req = http.getRequest();
    const res = http.getResponse();

    const record = () => {
      const route = req.route?.path
        ? `${req.baseUrl ?? ''}${req.route.path}`
        : 'unmatched';
      const seconds = Number(process.hrtime.bigint() - start) / 1e9;
      this.metrics.observe(req.method, route, res.statusCode, seconds);
    };

    return next.handle().pipe(tap({ next: record, error: record }));
  }
}
