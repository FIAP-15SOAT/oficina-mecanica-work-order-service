import { Logger as NestLogger, PinoLogger } from 'nestjs-pino';

import { QuoteStatus } from '@domain/enums/quote-status.enum';
import { BUSINESS_EVENTS } from '@application/logging/business-event.catalog';
import { defineLogEvent } from '@application/logging/log-event';
import { buildLoggerParams } from '@infrastructure/logging/logging.module';
import * as payloadSanitizer from '@infrastructure/logging/redaction/payload-sanitizer';
import { PinoLoggerAdapter } from '@infrastructure/logging/pino-logger.adapter';
import { REDACTED } from '@infrastructure/logging/redaction/text-sanitizer';
import { captureDiagnostics } from '../../../helpers/diagnostics-capture';

// nestjs-pino 5 builds its root logger once per process and exposes no reset, so every
// PinoLogger in this file shares one destination and each test points it at its own buffer.
let sink: (line: string) => void = () => undefined;
const params = buildLoggerParams({ write: (line: string) => sink(line) }, 'debug');

function captureLines(): Record<string, unknown>[] {
  const lines: Record<string, unknown>[] = [];
  sink = (line) => lines.push(JSON.parse(line) as Record<string, unknown>);
  return lines;
}

describe('PinoLoggerAdapter', () => {
  let lines: Record<string, unknown>[];
  let pinoLogger: PinoLogger;
  let adapter: PinoLoggerAdapter;

  beforeEach(() => {
    lines = captureLines();
    pinoLogger = new PinoLogger(params);
    adapter = new PinoLoggerAdapter(pinoLogger);
  });

  it('should emit the envelope with a text level and an ISO-8601 UTC timestamp', () => {
    adapter.info('service ready');

    expect(lines).toHaveLength(1);
    expect(lines[0].level).toBe('info');
    expect(lines[0].message).toBe('service ready');
    expect(lines[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('should preserve request.id when a scoped logger is used inside a request context', () => {
    pinoLogger.runInContext(
      () => {
        adapter.forContext('ApproveQuoteUseCase').info('quote approved');
      },
      { bindings: { 'request.id': 'req-abc' } },
    );

    expect(lines).toHaveLength(1);
    expect(lines[0]['request.id']).toBe('req-abc');
    expect(lines[0]['otel.scope.name']).toBe('ApproveQuoteUseCase');
  });

  it('should keep request.id on every call made through the same scoped logger', () => {
    const scoped = adapter.forContext('ApproveQuoteUseCase');

    pinoLogger.runInContext(
      () => {
        scoped.info('first');
        scoped.info('second');
      },
      { bindings: { 'request.id': 'req-abc' } },
    );

    expect(lines.map((line) => line['request.id'])).toEqual(['req-abc', 'req-abc']);
  });

  it('should not carry a scope from another correlated request', () => {
    const scoped = adapter.forContext('ApproveQuoteUseCase');

    pinoLogger.runInContext(() => scoped.info('first'), { bindings: { 'request.id': 'a' } });
    pinoLogger.runInContext(() => scoped.info('second'), { bindings: { 'request.id': 'b' } });

    expect(lines.map((line) => line['request.id'])).toEqual(['a', 'b']);
  });

  it('should map logical event fields to their physical telemetry keys', () => {
    adapter.event(BUSINESS_EVENTS.QUOTE_APPROVED, {
      quoteId: 'quote-1',
      previousQuoteStatus: QuoteStatus.SENT,
      workOrderId: 'wo-1',
      workOrderNumber: 'OS-0001',
      previousWorkOrderStatus: 'AWAITING_APPROVAL',
      customerId: 'customer-1',
    });

    expect(lines[0]).toMatchObject({
      level: 'info',
      message: BUSINESS_EVENTS.QUOTE_APPROVED.message,
      'oficina.event.name': 'quote.approved',
      'oficina.quote.id': 'quote-1',
      'oficina.quote.status.previous': QuoteStatus.SENT,
      'oficina.work_order.id': 'wo-1',
      'oficina.work_order.number': 'OS-0001',
      'oficina.work_order.status.previous': 'AWAITING_APPROVAL',
    });
    expect(lines[0]).not.toHaveProperty('quoteId');
  });

  it('should mask a field the registry classifies as personal data', () => {
    adapter.event(BUSINESS_EVENTS.AUTHENTICATION_SUCCEEDED, {
      subjectId: 'user-1',
      subjectName: 'Maria Silva',
      subjectEmail: 'maria.silva@gmail.com',
    });

    expect(lines[0]).toMatchObject({
      'oficina.auth.subject.id': 'user-1',
      'oficina.auth.subject.name': 'Ma***va',
      'oficina.auth.subject.email': 'ma***va@gmail.com',
    });
  });

  it('should not mask a catalog name, which is not personal data', () => {
    adapter.event(BUSINESS_EVENTS.STOCK_UPDATED, {
      partSupplyId: 'part-1',
      partSupplyName: 'Filtro de óleo',
      movementType: 'ENTRY',
      movementQuantity: 5,
      currentQuantity: 12,
    });

    expect(lines[0]['oficina.part_supply.name']).toBe('Filtro de óleo');
  });

  it('should omit optional event fields that are not provided', () => {
    adapter.event(BUSINESS_EVENTS.AUTHENTICATION_FAILED, { failureReason: 'unknown_user' });

    expect(lines[0]['oficina.auth.failure.reason']).toBe('unknown_user');
    expect(lines[0]).not.toHaveProperty('oficina.auth.subject.id');
  });

  it('should omit an optional event field explicitly passed as undefined', () => {
    adapter.event(BUSINESS_EVENTS.AUTHENTICATION_FAILED, {
      failureReason: 'unknown_user',
      subjectId: undefined,
    });

    expect(lines[0]).not.toHaveProperty('oficina.auth.subject.id');
  });

  it('should drop a field the registry does not know', () => {
    const stderr = captureDiagnostics();

    const rogue = defineLogEvent<{ quoteId: string }>({
      name: 'quote.rogue',
      message: 'rogue',
      level: 'info',
    });

    adapter.event(rogue, { quoteId: 'quote-1', unknownField: 'x' } as never);

    expect(lines[0]['oficina.quote.id']).toBe('quote-1');
    expect(lines[0]).not.toHaveProperty('unknownField');
    expect(String(stderr.spy.mock.calls[0][0])).toContain(
      '"oficina.logging.failure.field":"unknownField"',
    );

    stderr.restore();
  });

  it('should route an error to the exception attributes without a cause namespace', () => {
    const cause = new TypeError('camada de baixo');
    const error = new Error('falha ao aprovar', { cause });

    adapter.error('falha', error);

    expect(lines[0]['exception.type']).toBe('TypeError');
    expect(lines[0]['exception.message']).toBe('falha ao aprovar');
    expect(lines[0]['exception.stacktrace']).toContain('Caused by:');
    expect(Object.keys(lines[0]).some((key) => key.startsWith('exception.cause'))).toBe(false);
  });

  it('should emit a level line carrying only the envelope and the scope', () => {
    adapter.forContext('Bootstrap').warn('TRUSTED_PROXY_CIDRS inválido');

    expect(lines[0]).toMatchObject({
      level: 'warn',
      message: 'TRUSTED_PROXY_CIDRS inválido',
      'otel.scope.name': 'Bootstrap',
    });
    expect(Object.keys(lines[0]).filter((key) => key.startsWith('oficina.'))).toEqual([]);
  });

  it('should emit debug through the same closed schema', () => {
    adapter.debug('detalhe');

    expect(lines[0].level).toBe('debug');
    expect(lines[0].message).toBe('detalhe');
  });

  it('should emit an error line without an exception when none is given', () => {
    adapter.error('falha sem exceção');

    expect(lines[0].level).toBe('error');
    expect(lines[0]).not.toHaveProperty('exception.type');
  });

  it('should write a single stderr diagnostic and not throw when emitting fails', () => {
    const stderr = captureDiagnostics();
    jest.spyOn(pinoLogger, 'info').mockImplementation(() => {
      throw new Error('serialization failure');
    });

    expect(() => adapter.info('boom')).not.toThrow();
    expect(stderr.spy).toHaveBeenCalledTimes(1);
    expect(String(stderr.spy.mock.calls[0][0])).toContain('"message":"logging failure"');

    stderr.restore();
  });

  it('should absorb a sanitizer failure raised while mapping event fields', () => {
    const stderr = captureDiagnostics();
    const sanitizer = jest.spyOn(payloadSanitizer, 'sanitizePayload').mockImplementation(() => {
      throw new Error('sanitizer failure');
    });

    expect(() =>
      adapter.event(BUSINESS_EVENTS.USER_STATUS_UPDATED, {
        targetUserId: 'user-1',
        targetUserActive: false,
      }),
    ).not.toThrow();

    expect(lines).toHaveLength(0);
    expect(stderr.spy).toHaveBeenCalledTimes(1);

    sanitizer.mockRestore();
    stderr.restore();
  });

  it('should report the field and drop it when the registry does not know the logical name', () => {
    const stderr = captureDiagnostics();

    adapter.event(BUSINESS_EVENTS.USER_STATUS_UPDATED, {
      targetUserId: 'user-1',
      targetUserActive: true,
    });

    expect(stderr.spy).not.toHaveBeenCalled();
    expect(lines[0]['oficina.target.user.active']).toBe(true);

    stderr.restore();
  });
});

describe('PinoLoggerAdapter — event with an attached exception', () => {
  it('should carry the exception attributes alongside the event fields', () => {
    const lines = captureLines();
    const adapter = new PinoLoggerAdapter(new PinoLogger(params));

    adapter.event(
      BUSINESS_EVENTS.USER_STATUS_UPDATED,
      { targetUserId: 'user-1', targetUserActive: false },
      new TypeError('falhou'),
    );

    expect(lines[0]).toMatchObject({
      'oficina.event.name': 'user.status.updated',
      'oficina.target.user.id': 'user-1',
      'exception.type': 'TypeError',
      'exception.message': 'falhou',
    });
  });
});

/**
 * `message` is the only key present in every line that does not go through
 * `formatters.log` — pino serializes it on a separate path. Worse: when the
 * object carries `err` and no message, pino **lifts `err.message` raw** into
 * the envelope, which is exactly what `nestjs-pino`'s bridge produces from
 * Nest's `error(message, stack)` contract.
 *
 * Without the serializer, the line came out with `exception.message` redacted
 * next to a `message` holding the whole connection string.
 */
describe('output — the message also goes through redaction', () => {
  const SENSITIVE = 'postgresql://app:S3nh4Secreta@db:5432/oficina para maria.silva@gmail.com';

  it('should sanitize a message emitted through the application port', () => {
    const lines = captureLines();

    new PinoLoggerAdapter(new PinoLogger(params)).warn(`falha em ${SENSITIVE}`);

    expect(lines[0].message).not.toContain('S3nh4Secreta');
    expect(lines[0].message).not.toContain('maria.silva@gmail.com');
    expect(lines[0].message).toContain(REDACTED);
  });

  it('should sanitize the message the framework bridge lifts from err.message', () => {
    const lines = captureLines();

    const bridge = new NestLogger(new PinoLogger(params), params);

    bridge.error(`falha em ${SENSITIVE}`, 'Error: x\n    at y', 'InstanceLoader');

    expect(lines[0].message).not.toContain('S3nh4Secreta');
    expect(lines[0].message).not.toContain('maria.silva@gmail.com');
    expect(lines[0].message).toEqual(lines[0]['exception.message']);
  });

  it('should leave an ordinary message untouched', () => {
    const lines = captureLines();

    new PinoLoggerAdapter(new PinoLogger(params)).info('http server accepting connections');

    expect(lines[0].message).toBe('http server accepting connections');
  });
});
