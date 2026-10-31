import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

import { LogEventDefinition, LogLevelName } from '@application/logging/log-event';
import { LogFields } from '@application/logging/log-field';
import {
  ILogger,
  NoExtraFields,
} from '@application/ports/output/services/logger.service.interface';

import { reportLoggingFailure, runSafelyVoid } from './logging-diagnostics';
import { describeError } from './error-serializer';
import { EVENT_NAME_FIELD, resolveLogicalField } from './field-registry';
import { maskScalar } from './redaction/pii-masker';
import { sanitizePayload } from './redaction/payload-sanitizer';

@Injectable()
export class PinoLoggerAdapter implements ILogger {
  constructor(
    private readonly pinoLogger: PinoLogger,
    private readonly scope?: string,
  ) {}

  forContext(scope: string): ILogger {
    return new PinoLoggerAdapter(this.pinoLogger, scope);
  }

  debug(message: string): void {
    this.emit('debug', message, emptyRecord);
  }

  info(message: string): void {
    this.emit('info', message, emptyRecord);
  }

  warn(message: string): void {
    this.emit('warn', message, emptyRecord);
  }

  error(message: string, error?: unknown): void {
    this.emit('error', message, () => (error === undefined ? {} : describeError(error)));
  }

  event<TFields extends LogFields, TGiven extends TFields>(
    definition: LogEventDefinition<TFields>,
    fields: NoExtraFields<TFields, TGiven>,
    error?: unknown,
  ): void {
    this.emit(definition.level, definition.message, () => ({
      [EVENT_NAME_FIELD.name]: definition.name,
      ...(error === undefined ? {} : describeError(error)),
      ...mapFields(fields),
    }));
  }

  private emit(
    level: LogLevelName,
    message: string,
    buildRecord: () => Record<string, unknown>,
  ): void {
    runSafelyVoid('emit', () => {
      const record = buildRecord();

      this.pinoLogger[level](
        this.scope ? { 'otel.scope.name': this.scope, ...record } : record,
        message,
      );
    });
  }
}

function emptyRecord(): Record<string, unknown> {
  return {};
}

function mapFields(fields: LogFields): Record<string, unknown> {
  const mapped: Record<string, unknown> = {};

  for (const [logicalName, value] of Object.entries(fields)) {
    if (value === undefined || value === null) {
      continue;
    }

    const definition = resolveLogicalField(logicalName);

    if (!definition) {
      reportLoggingFailure('emit', { field: logicalName });

      continue;
    }

    mapped[definition.key] =
      definition.sensitivity === 'pii' ? maskScalar(value) : sanitizePayload(value);
  }

  return mapped;
}
