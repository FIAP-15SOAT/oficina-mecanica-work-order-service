import { MAX_TEXT_LENGTH, REDACTED } from '@infrastructure/logging/redaction/text-sanitizer';
import {
  createTelemetryDiagLogger,
  MAX_TELEMETRY_DETAIL_LENGTH,
  MAX_TRACKED_CAUSES,
  reportTelemetryFailure,
  TELEMETRY_FAILURE_MESSAGE,
} from '@infrastructure/telemetry/telemetry-diagnostics';
import { captureDiagnostics, DiagnosticsCapture } from '../../../helpers/diagnostics-capture';

const JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4ifQ.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';

describe('reportTelemetryFailure', () => {
  let diagnostics: DiagnosticsCapture;

  beforeEach(() => {
    diagnostics = captureDiagnostics();
  });

  afterEach(() => {
    diagnostics.restore();
  });

  /**
   * The channel is the same as logging's — stderr, with the same envelope and
   * the same resource attributes. One of these lines on **stdout** would break
   * the contract of one JSON object per line with every key declared.
   */
  it('should write to the error channel with the envelope and resource attributes', () => {
    reportTelemetryFailure('shutdown');

    const [line] = diagnostics.lines();

    expect(line.message).toBe(TELEMETRY_FAILURE_MESSAGE);
    expect(line.level).toBe('error');
    expect(line['service.name']).toBeDefined();
    expect(line['oficina.telemetry.failure.stage']).toBe('shutdown');
    expect(line).not.toHaveProperty('oficina.telemetry.failure.detail');
  });

  it('should describe an error by name and message, without the stack', () => {
    reportTelemetryFailure('metric-emission', new TypeError('meter indisponível'));

    const [line] = diagnostics.lines();

    expect(line['oficina.telemetry.failure.detail']).toBe('TypeError: meter indisponível');
  });

  it('should describe a non-textual detail by type, never by value', () => {
    reportTelemetryFailure('diagnostic', { endpoint: 'http://interno:4318' });

    expect(diagnostics.text()).toContain('"oficina.telemetry.failure.detail":"object"');
    expect(diagnostics.text()).not.toContain('interno');
  });
});

describe('createTelemetryDiagLogger', () => {
  let diagnostics: DiagnosticsCapture;

  beforeEach(() => {
    diagnostics = captureDiagnostics();
  });

  afterEach(() => {
    diagnostics.restore();
  });

  it.each(['error', 'warn'] as const)('should forward %s to the error channel', (level) => {
    createTelemetryDiagLogger()[level]('falha ao exportar');

    const [line] = diagnostics.lines();

    expect(line['oficina.telemetry.failure.stage']).toBe('diagnostic');
    expect(line['oficina.telemetry.failure.detail']).toContain('falha ao exportar');
  });

  it.each(['info', 'debug', 'verbose'] as const)('should not emit a line for %s', (level) => {
    createTelemetryDiagLogger()[level]('detalhe de rotina');

    expect(diagnostics.text()).toBe('');
  });

  /**
   * Measured: OTel's `globalErrorHandler` hands `diag` the error **serialized
   * with the whole stack** — ~2 KB of absolute paths per occurrence, repeated on
   * every periodic reader interval.
   */
  it('should cut the detail at its own limit, well below the log free text limit', () => {
    expect(MAX_TELEMETRY_DETAIL_LENGTH).toBeLessThan(MAX_TEXT_LENGTH);

    createTelemetryDiagLogger().error('x'.repeat(5_000));

    const [line] = diagnostics.lines();

    expect((line['oficina.telemetry.failure.detail'] as string).length).toBeLessThanOrEqual(
      MAX_TELEMETRY_DETAIL_LENGTH,
    );
  });

  /**
   * The text comes from the library and may carry an endpoint, a header or a
   * driver message: the diagnostic channel must not become the leak path
   * redaction exists to close.
   */
  it('should scrub the library text with the same scrubber the log uses', () => {
    createTelemetryDiagLogger().error('falha ao exportar', new Error(`token=${JWT}`));

    expect(diagnostics.text()).not.toContain(JWT.slice(0, 40));
    expect(diagnostics.text()).toContain(REDACTED);
  });
});

describe('reportTelemetryFailure — severity and repetition', () => {
  let diagnostics: DiagnosticsCapture;

  beforeEach(() => {
    diagnostics = captureDiagnostics();
  });

  afterEach(() => {
    diagnostics.restore();
  });

  /**
   * Dropping a span because the queue is full arrives as `diag.warn` and is
   * behavior **declared as accepted**. Flattening it into `error` — as the
   * channel did — makes any alert on this stream useless: the normal degraded
   * path becomes indistinguishable from a real failure.
   */
  it('should preserve the severity of the reporter', () => {
    reportTelemetryFailure('diagnostic', 'fila cheia', 'warn');
    reportTelemetryFailure('shutdown', 'export falhou', 'error');

    expect(diagnostics.lines().map((line) => line.level)).toEqual(['warn', 'error']);
  });

  /**
   * Measured in the smoke: 60 s against an unreachable destination produced 78
   * identical lines. Without a cap, the observability failure takes over the
   * application's own error channel and hides everything else.
   */
  it('should emit the first occurrence and aggregate repetitions of the same cause', () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      reportTelemetryFailure('diagnostic', 'connect ECONNREFUSED');
    }

    expect(diagnostics.lines()).toHaveLength(1);
  });

  it('should not suppress a different cause', () => {
    reportTelemetryFailure('diagnostic', 'connect ECONNREFUSED');
    reportTelemetryFailure('diagnostic', 'socket hang up');

    expect(diagnostics.lines()).toHaveLength(2);
  });

  /**
   * The cause map is module state and lives as long as the process: without a
   * cap, a detail with a variable part (ephemeral port, attempt id) creates one
   * entry per occurrence and the diagnostic channel starts leaking memory.
   */
  it('should drop the tracked causes once the ceiling is reached', () => {
    for (let cause = 0; cause < MAX_TRACKED_CAUSES; cause += 1) {
      reportTelemetryFailure('diagnostic', `connect ECONNREFUSED 10.0.0.${cause}`);
    }

    reportTelemetryFailure('diagnostic', 'connect ECONNREFUSED 198.51.100.1');
    reportTelemetryFailure('diagnostic', 'connect ECONNREFUSED 10.0.0.0');

    expect(diagnostics.lines()).toHaveLength(MAX_TRACKED_CAUSES + 2);
  });

  it('should count suppressed occurrences on the next line of the same cause', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    reportTelemetryFailure('diagnostic', 'connect ECONNREFUSED');
    reportTelemetryFailure('diagnostic', 'connect ECONNREFUSED');
    reportTelemetryFailure('diagnostic', 'connect ECONNREFUSED');

    jest.setSystemTime(new Date('2026-01-01T00:02:00.000Z'));
    reportTelemetryFailure('diagnostic', 'connect ECONNREFUSED');

    const lines = diagnostics.lines();

    expect(lines).toHaveLength(2);
    expect(lines[1]['oficina.telemetry.failure.suppressed']).toBe('2');

    jest.useRealTimers();
  });
});
