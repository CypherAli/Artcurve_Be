import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

// ─────────────────────────────────────────────────────────────────────────────
//  TransformInterceptor  (src/common/interceptors/)
//
//  Global response wrapper — bọc MỌI successful response vào envelope:
//
//  Trước (controller trả về trực tiếp):
//    { "id": "...", "title": "..." }
//
//  Sau (với interceptor):
//    { "data": { "id": "...", "title": "..." } }
//
//  Lợi ích:
//    - Frontend biết chắc data luôn nằm trong key "data"
//    - Dễ thêm metadata sau này: { data, meta: { total, page, ... } }
//    - Phân biệt rõ success response với error response
//      (error từ AllExceptionsFilter KHÔNG có "data", có "statusCode" trực tiếp)
//
//  Ngoại lệ — KHÔNG bọc:
//    - void / undefined response (e.g. 204 No Content)
//    - Response đã là ResponseWrapper (tránh double-wrap)
//
//  Cách apply trong main.ts:
//    app.useGlobalInterceptors(new TransformInterceptor());
// ─────────────────────────────────────────────────────────────────────────────

export interface ResponseWrapper<T> {
  data: T;
}

@Injectable()
export class TransformInterceptor<T>
  implements NestInterceptor<T, ResponseWrapper<T> | void>
{
  intercept(
    _context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<ResponseWrapper<T> | void> {
    return next.handle().pipe(
      map((data) => {
        // void / undefined → pass-through (204 No Content)
        if (data === undefined || data === null) {
          return data as unknown as void;
        }

        // Đã là envelope → không wrap lại
        if (
          typeof data === 'object' &&
          data !== null &&
          'data' in (data as object)
        ) {
          return data as unknown as ResponseWrapper<T>;
        }

        return { data };
      }),
    );
  }
}
