import { reportTelemetryFailure } from './telemetry-diagnostics';

/**
 * Shutdown budget. The orchestrator's window is `terminationGracePeriodSeconds`
 * (40 s), of which 10 s are already the drain window — 30 s are left, shared
 * with the server close and Prisma's `$disconnect()`.
 *
 * The SDK defaults do **not** fit there: the periodic reader uses a 30 s export
 * deadline and the OTLP exporter 10 s. And a purely external deadline — a race
 * against a clock in the hook — abandons the wait without **cancelling** the
 * export: the handle stays alive, the process does not end and `SIGKILL` cuts
 * the flush and the following hooks along with it.
 */
export const DEFAULT_EXPORT_TIMEOUT_MS = 5_000;

export const DEFAULT_METRIC_EXPORT_TIMEOUT_MS = 5_000;

export const DEFAULT_METRIC_EXPORT_INTERVAL_MS = 60_000;

/**
 * Measured floor, not chosen. Below 1 s the process **never ends**: the deadline
 * shrinks along with the interval (see `resolveMetricExportTiming`), so a new
 * export starts before the previous socket is released and a live handle is
 * always left in the event loop.
 */
export const MIN_METRIC_EXPORT_INTERVAL_MS = 1_000;

export const TELEMETRY_SHUTDOWN_TIMEOUT_MS = 8_000;

export interface MetricExportTiming {
  intervalMillis: number;
  timeoutMillis: number;
}

export function resolveTimeoutMs(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw?.trim());

  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * An export deadline **longer** than the shutdown hook's cap defeats the cap:
 * `Promise.race` abandons the wait, but the export handle stays alive, the
 * process does not end and `SIGKILL` cuts the following hooks along with it.
 * That is why the operator override is accepted up to the limit where it still
 * cancels in time, and reduced — with a diagnostic — above it.
 */
export function resolveExportTimeoutMs(raw: string | undefined, fallback: number): number {
  const requested = resolveTimeoutMs(raw, fallback);

  if (requested < TELEMETRY_SHUTDOWN_TIMEOUT_MS) {
    return requested;
  }

  reportTelemetryFailure('config', `export-timeout-clamped:${requested}`);

  return DEFAULT_EXPORT_TIMEOUT_MS;
}

/**
 * The two periodic reader variables are **related**, and the constructor throws
 * when the interval is shorter than the deadline. Resolving them separately left
 * a wide range of plausible values — any `OTEL_METRIC_EXPORT_INTERVAL` below the
 * 5 s default deadline, `1000` included — crashing the process in the preload,
 * before any log line existed.
 *
 */
export function resolveMetricExportTiming(
  env: NodeJS.ProcessEnv = process.env,
): MetricExportTiming {
  const intervalMillis = resolveMetricIntervalMs(env.OTEL_METRIC_EXPORT_INTERVAL);
  const timeoutMillis = resolveExportTimeoutMs(
    env.OTEL_METRIC_EXPORT_TIMEOUT,
    DEFAULT_METRIC_EXPORT_TIMEOUT_MS,
  );

  if (timeoutMillis <= intervalMillis) {
    return { intervalMillis, timeoutMillis };
  }

  reportTelemetryFailure(
    'config',
    `metric-timeout-above-interval:${timeoutMillis}>${intervalMillis}`,
  );

  return { intervalMillis, timeoutMillis: intervalMillis };
}

function resolveMetricIntervalMs(raw: string | undefined): number {
  const requested = resolveTimeoutMs(raw, DEFAULT_METRIC_EXPORT_INTERVAL_MS);

  if (requested >= MIN_METRIC_EXPORT_INTERVAL_MS) {
    return requested;
  }

  reportTelemetryFailure('config', `metric-interval-clamped:${requested}`);

  return MIN_METRIC_EXPORT_INTERVAL_MS;
}
