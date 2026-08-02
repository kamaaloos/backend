import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { Request, Response } from 'express';
import { setActiveSpanAttributes } from '../../telemetry/tracing';

@Injectable()
export class RequestLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const started = Date.now();
    const { method, originalUrl } = req;

    setActiveSpanAttributes({
      'http.route': originalUrl,
      'http.request.method': method,
    });

    return next.handle().pipe(
      tap({
        next: () => {
          const durationMs = Date.now() - started;
          setActiveSpanAttributes({
            'http.response.status_code': res.statusCode,
            'http.server.request.duration_ms': durationMs,
          });
          this.logger.log(
            JSON.stringify({
              method,
              path: originalUrl,
              status: res.statusCode,
              durationMs,
            }),
          );
        },
        error: (err: { status?: number }) => {
          const durationMs = Date.now() - started;
          const status = err?.status ?? 500;
          setActiveSpanAttributes({
            'http.response.status_code': status,
            'http.server.request.duration_ms': durationMs,
          });
          this.logger.warn(
            JSON.stringify({
              method,
              path: originalUrl,
              status,
              durationMs,
            }),
          );
        },
      }),
    );
  }
}
