/* eslint-disable @typescript-eslint/no-require-imports --
 * `jest.isolateModules` takes a **synchronous** callback: the module registry
 * must be swapped and restored inside it, and a dynamic `import()` would only
 * resolve after the isolation had ended. This is the only place in the project
 * that loads the preload on purpose, and it needs a clean registry per test
 * case.
 */
import { metrics, trace } from '@opentelemetry/api';

import {
  getTelemetrySdk,
  registerTelemetrySdk,
} from '@infrastructure/telemetry/telemetry-sdk.registry';

/**
 * The switch is the **absence** of a destination address, not a dedicated
 * enable variable — which would be a second truth about the same state. It is
 * what keeps the E2E suites and local development without a background
 * exporter, and what makes "observability down ⇒ application down" impossible
 * by construction.
 */
describe('otel — disabled when no endpoint is configured', () => {
  const OTEL_KEYS = [
    'OTEL_EXPORTER_OTLP_ENDPOINT',
    'OTEL_LOGS_EXPORTER',
    'OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE',
  ] as const;

  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = Object.fromEntries(OTEL_KEYS.map((key) => [key, process.env[key]]));

    for (const key of OTEL_KEYS) {
      delete process.env[key];
    }

    registerTelemetrySdk(undefined);
  });

  afterEach(() => {
    for (const key of OTEL_KEYS) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    }

    registerTelemetrySdk(undefined);
  });

  it('should not instantiate the SDK nor register the instance', () => {
    jest.isolateModules(() => {
      const { telemetrySdk } = require('../../src/otel') as { telemetrySdk?: unknown };

      expect(telemetrySdk).toBeUndefined();
    });

    expect(getTelemetrySdk()).toBeUndefined();
  });

  /**
   * `applyPipelineDefaults` only runs after the switch. The untouched variables
   * are the observable proof that nothing was built.
   */
  it('should not apply any pipeline configuration', () => {
    jest.isolateModules(() => {
      require('../../src/otel');
    });

    expect(process.env.OTEL_LOGS_EXPORTER).toBeUndefined();
    expect(process.env.OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE).toBeUndefined();
  });

  it('should leave the global API providers as no-op', () => {
    jest.isolateModules(() => {
      require('../../src/otel');
    });

    expect(metrics.getMeterProvider().constructor.name).toBe('NoopMeterProvider');
    expect(trace.getTracerProvider().constructor.name).toBe('ProxyTracerProvider');
  });

  it('should treat a blank endpoint as absent', () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = '   ';

    jest.isolateModules(() => {
      const { telemetrySdk } = require('../../src/otel') as { telemetrySdk?: unknown };

      expect(telemetrySdk).toBeUndefined();
    });

    expect(process.env.OTEL_LOGS_EXPORTER).toBeUndefined();
  });
});
