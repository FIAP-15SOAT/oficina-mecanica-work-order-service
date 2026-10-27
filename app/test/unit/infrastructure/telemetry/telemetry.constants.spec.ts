import { DRAIN_WINDOW_MS } from '@infrastructure/health/readiness-state';
import {
  DEFAULT_EXPORT_TIMEOUT_MS,
  DEFAULT_METRIC_EXPORT_INTERVAL_MS,
  DEFAULT_METRIC_EXPORT_TIMEOUT_MS,
  MIN_METRIC_EXPORT_INTERVAL_MS,
  resolveExportTimeoutMs,
  resolveMetricExportTiming,
  resolveTimeoutMs,
  TELEMETRY_SHUTDOWN_TIMEOUT_MS,
} from '@infrastructure/telemetry/telemetry.constants';
import { captureDiagnostics, DiagnosticsCapture } from '../../../helpers/diagnostics-capture';

/**
 * The Deployment's `terminationGracePeriodSeconds`. It is not read from the
 * manifest on purpose — what this spec guards is the **relation** between the
 * code's deadlines; the orchestrator's number comes in as a declared reference,
 * and a change there that breaks the arithmetic shows up here as a failure, not
 * in production.
 */
const TERMINATION_GRACE_PERIOD_MS = 40_000;

describe('resolveTimeoutMs', () => {
  it('should use the variable value when it is a positive number', () => {
    expect(resolveTimeoutMs('2500', 9_000)).toBe(2500);
    expect(resolveTimeoutMs('  7000  ', 9_000)).toBe(7000);
  });

  /**
   * Falls back to the declared default, never to `0` or `NaN`: a zero deadline
   * would abort every export, and a `NaN` would make the SDK throw while building
   * the reader — telemetry crashing the boot is exactly what must not happen.
   */
  it.each([undefined, '', '   ', 'abc', '0', '-1', 'Infinity'])(
    'should fall back to the default for the value %p',
    (raw) => {
      expect(resolveTimeoutMs(raw, 9_000)).toBe(9_000);
    },
  );
});

describe('shutdown budget', () => {
  /**
   * The budget arithmetic: what is left of the orchestrator's window after the
   * drain must fit the flush **and** Prisma's `$disconnect()`. The SDK defaults
   * (10 s for OTLP, 30 s for the metric reader) do not fit — that is why these
   * numbers exist.
   */
  it('should fit in what is left of the orchestrator window after the drain', () => {
    const remaining = TERMINATION_GRACE_PERIOD_MS - DRAIN_WINDOW_MS;

    expect(TELEMETRY_SHUTDOWN_TIMEOUT_MS).toBeLessThan(remaining);
    expect(remaining - TELEMETRY_SHUTDOWN_TIMEOUT_MS).toBeGreaterThanOrEqual(10_000);
  });

  /**
   * The hook cap is a safety net: what actually **cancels** the export is the
   * exporters' deadlines. If they were longer, the hook would abandon the wait
   * with the handle still alive and the process would stay stuck.
   */
  it('should keep the exporter timeouts below the hook ceiling', () => {
    expect(DEFAULT_EXPORT_TIMEOUT_MS).toBeLessThan(TELEMETRY_SHUTDOWN_TIMEOUT_MS);
    expect(DEFAULT_METRIC_EXPORT_TIMEOUT_MS).toBeLessThan(TELEMETRY_SHUTDOWN_TIMEOUT_MS);
  });

  /**
   * The periodic reader refuses an interval shorter than the export deadline.
   */
  it('should keep the collection interval above the export timeout', () => {
    expect(DEFAULT_METRIC_EXPORT_INTERVAL_MS).toBeGreaterThan(DEFAULT_METRIC_EXPORT_TIMEOUT_MS);
  });
});

describe('resolveMetricExportTiming', () => {
  let diagnostics: DiagnosticsCapture;

  beforeEach(() => {
    diagnostics = captureDiagnostics();
  });

  afterEach(() => {
    diagnostics.restore();
  });

  it('should use the declared defaults when nothing is configured', () => {
    expect(resolveMetricExportTiming({})).toEqual({
      intervalMillis: DEFAULT_METRIC_EXPORT_INTERVAL_MS,
      timeoutMillis: DEFAULT_METRIC_EXPORT_TIMEOUT_MS,
    });
  });

  /**
   * The preload calls it without an argument: `process.env` is what the
   * deployment configures, and a required parameter would exist only for the
   * test.
   */
  it('should read the process environment when no environment is given', () => {
    process.env.OTEL_METRIC_EXPORT_INTERVAL = '30000';

    try {
      expect(resolveMetricExportTiming()).toEqual({
        intervalMillis: 30_000,
        timeoutMillis: DEFAULT_METRIC_EXPORT_TIMEOUT_MS,
      });
    } finally {
      delete process.env.OTEL_METRIC_EXPORT_INTERVAL;
    }
  });

  /**
   * The periodic reader's constructor **throws** when the interval is shorter
   * than the deadline, and in a preload that is fatal: measured before the fix,
   * any `OTEL_METRIC_EXPORT_INTERVAL` below the 5 s default — `1000` included —
   * crashed the process with code 1, without a line on stdout, and the replica
   * went into CrashLoop. Resolving the two variables separately was the hole.
   */
  it('should shrink the timeout down to the requested interval instead of letting the constructor throw', () => {
    expect(resolveMetricExportTiming({ OTEL_METRIC_EXPORT_INTERVAL: '1000' })).toEqual({
      intervalMillis: 1000,
      timeoutMillis: 1000,
    });
    expect(diagnostics.text()).toContain('metric-timeout-above-interval');
  });

  /**
   * Below the floor the deadline shrinks along with the interval, and the next
   * export starts before the previous socket is released: a live handle is
   * always left and the process **never ends**. Measured against an unreachable
   * destination — 25 s without exit at `1`, `10`, `100` and `500`; exit 0 at
   * `1000`.
   */
  it.each(['1', '10', '100', '500'])(
    'should raise to the floor the interval %p, which prevents the process from exiting',
    (interval) => {
      expect(resolveMetricExportTiming({ OTEL_METRIC_EXPORT_INTERVAL: interval })).toEqual({
        intervalMillis: MIN_METRIC_EXPORT_INTERVAL_MS,
        timeoutMillis: MIN_METRIC_EXPORT_INTERVAL_MS,
      });
      expect(diagnostics.text()).toContain('metric-interval-clamped');
    },
  );

  it('should respect the operator override when it is coherent', () => {
    expect(
      resolveMetricExportTiming({
        OTEL_METRIC_EXPORT_INTERVAL: '30000',
        OTEL_METRIC_EXPORT_TIMEOUT: '3000',
      }),
    ).toEqual({ intervalMillis: 30_000, timeoutMillis: 3_000 });
    expect(diagnostics.text()).toBe('');
  });
});

describe('resolveExportTimeoutMs', () => {
  let diagnostics: DiagnosticsCapture;

  beforeEach(() => {
    diagnostics = captureDiagnostics();
  });

  afterEach(() => {
    diagnostics.restore();
  });

  it('should accept an override that still cancels within the hook ceiling', () => {
    expect(resolveExportTimeoutMs('2000', DEFAULT_EXPORT_TIMEOUT_MS)).toBe(2000);
    expect(diagnostics.text()).toBe('');
  });

  /**
   * A deadline longer than the hook cap defeats the cap: `Promise.race` abandons
   * the wait, the export handle stays alive, the process does not end and
   * `SIGKILL` cuts the following hooks along with it.
   */
  it('should reduce an override that would overrun the shutdown window', () => {
    expect(resolveExportTimeoutMs('600000', DEFAULT_EXPORT_TIMEOUT_MS)).toBe(
      DEFAULT_EXPORT_TIMEOUT_MS,
    );
    expect(diagnostics.text()).toContain('export-timeout-clamped');
  });
});
