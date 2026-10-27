import { DiagLogger } from '@opentelemetry/api';

import { writeDiagnostic } from '@infrastructure/logging/logging-diagnostics';
import { sanitizeText } from '@infrastructure/logging/redaction/text-sanitizer';

export const TELEMETRY_FAILURE_MESSAGE = 'telemetry failure';

export const MAX_TELEMETRY_DETAIL_LENGTH = 256;

export const TELEMETRY_REPORT_WINDOW_MS = 60_000;

export const MAX_TRACKED_CAUSES = 64;

export type TelemetryFailureStage =
  | 'config'
  | 'startup'
  | 'diagnostic'
  | 'shutdown'
  | 'metric-emission';

export type TelemetrySeverity = 'warn' | 'error';

interface CauseState {
  reportedAt: number;
  suppressed: number;
}

const causes = new Map<string, CauseState>();

/**
 * Test seam: the repetition window is module state, so two cases triggering the
 * **same** cause would see the second one suppressed. `captureDiagnostics`
 * calls this when it starts observing the channel.
 */
export function resetTelemetryDiagnostics(): void {
  causes.clear();
}

/**
 * OTel's `diag` writes to the console by default, and an export failure would
 * print free text on **stdout** — which here is a closed contract: one JSON
 * object per line, every key declared.
 */
export function reportTelemetryFailure(
  stage: TelemetryFailureStage,
  detail?: unknown,
  severity: TelemetrySeverity = 'error',
): void {
  const described = detail === undefined ? undefined : describeDetail(detail);
  const suppressed = registerCause(`${severity}:${stage}:${described ?? ''}`);

  if (suppressed === undefined) {
    return;
  }

  writeDiagnostic(
    TELEMETRY_FAILURE_MESSAGE,
    {
      'oficina.telemetry.failure.stage': stage,
      ...(described === undefined ? {} : { 'oficina.telemetry.failure.detail': described }),
      ...(suppressed > 0 ? { 'oficina.telemetry.failure.suppressed': String(suppressed) } : {}),
    },
    severity,
  );
}

/**
 * Returns how many occurrences were suppressed since the last line of this
 * cause, or `undefined` when this occurrence must be suppressed. The first one
 * always goes out — the window limits repetition, never the first signal of a
 * new cause.
 */
function registerCause(fingerprint: string): number | undefined {
  const now = Date.now();
  const state = causes.get(fingerprint);

  if (state && now - state.reportedAt < TELEMETRY_REPORT_WINDOW_MS) {
    state.suppressed += 1;

    return undefined;
  }

  if (!state && causes.size >= MAX_TRACKED_CAUSES) {
    causes.clear();
  }

  causes.set(fingerprint, { reportedAt: now, suppressed: 0 });

  return state?.suppressed ?? 0;
}

/**
 * Must be installed **before** `new NodeSDK(...)`: the constructor installs a
 * `DiagConsoleLogger` on its own when `OTEL_LOG_LEVEL` is set, and it already
 * **emits** during construction — measured, a raw line
 * (`@opentelemetry/api: Registered a global for diag`) on stdout, before any
 * chance to overwrite the channel.
 */
export function createTelemetryDiagLogger(): DiagLogger {
  const report =
    (severity: TelemetrySeverity) =>
    (message: string, ...args: unknown[]): void => {
      reportTelemetryFailure(
        'diagnostic',
        [message, ...args.map(describeDetail)].join(' '),
        severity,
      );
    };

  return {
    error: report('error'),
    warn: report('warn'),
    info: () => undefined,
    debug: () => undefined,
    verbose: () => undefined,
  };
}

function describeDetail(detail: unknown): string {
  if (detail instanceof Error) {
    return sanitizeText(`${detail.name}: ${detail.message}`, MAX_TELEMETRY_DETAIL_LENGTH);
  }

  if (typeof detail === 'string') {
    return sanitizeText(detail, MAX_TELEMETRY_DETAIL_LENGTH);
  }

  return typeof detail;
}
