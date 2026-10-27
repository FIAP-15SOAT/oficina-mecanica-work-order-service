import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

/**
 * Global interceptor that converts every Date object in the responses to
 * ISO 8601 with the Brasília offset (UTC-3).
 *
 * Brazil has had no daylight saving time since 2019, so the offset is fixed
 * at -03:00.
 */
@Injectable()
export class DateSerializerInterceptor implements NestInterceptor {
  private readonly BRAZIL_OFFSET_MS = -3 * 60 * 60 * 1000;

  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(map((data) => this.transform(data)));
  }

  private transform(value: unknown): unknown {
    if (value === null || value === undefined) return value;

    if (value instanceof Date) {
      const localMs = value.getTime() + this.BRAZIL_OFFSET_MS;
      return new Date(localMs).toISOString().replace('Z', '-03:00');
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.transform(item));
    }

    if (typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, this.transform(v)]),
      );
    }

    return value;
  }
}
