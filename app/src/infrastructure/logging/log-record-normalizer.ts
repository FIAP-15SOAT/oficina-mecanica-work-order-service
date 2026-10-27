import { describeError } from './error-serializer';
import { isDeclaredField } from './field-registry';
import { reportLoggingFailure } from './logging-diagnostics';

const LIBRARY_ERROR_KEYS = new Set(['err', 'error']);

/**
 * Last gate before the line goes out: converts the error object libraries attach
 * (`err`/`error`) into the `exception.*` attributes and drops any key not
 * declared in the field registry.
 *
 * This is what guarantees a closed schema. A new attribute that escapes
 * undeclared reaches the backend with an undefined type — and a field whose
 * type varies across records makes the index drop the whole event, not just
 * the field.
 */
export function normalizeLogRecord(record: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};

  for (const key of Object.keys(record)) {
    try {
      const value = record[key];

      if (LIBRARY_ERROR_KEYS.has(key) && value instanceof Error) {
        Object.assign(normalized, describeError(value));

        continue;
      }

      if (!isDeclaredField(key)) {
        continue;
      }

      normalized[key] = value;
    } catch (error) {
      reportLoggingFailure('serialization', {
        field: key,
        errorType: error instanceof Error ? error.name : typeof error,
      });
    }
  }

  return normalized;
}
