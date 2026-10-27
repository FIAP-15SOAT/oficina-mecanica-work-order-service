import { ArgumentMetadata, Injectable, PipeTransform } from '@nestjs/common';

@Injectable()
export class SanitizeStringsPipe implements PipeTransform {
  transform(value: unknown, _metadata: ArgumentMetadata): unknown {
    return this.sanitize(value);
  }

  private sanitize(value: unknown): unknown {
    if (typeof value === 'string') {
      return value.replaceAll('\0', '');
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.sanitize(item));
    }

    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, this.sanitize(v)]),
      );
    }

    return value;
  }
}
