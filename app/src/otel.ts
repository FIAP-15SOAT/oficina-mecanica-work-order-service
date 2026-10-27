/* eslint-disable @typescript-eslint/no-require-imports --
 * The SDK modules are loaded **inside** `startTelemetry`, after the switch.
 * With top-level `import`, the preload paid for the whole SDK even with telemetry off
 */
import { isMainThread } from 'node:worker_threads';
import type { DiagLogLevel } from '@opentelemetry/api';
import type { NodeSDK } from '@opentelemetry/sdk-node';

import {
  createTelemetryDiagLogger,
  reportTelemetryFailure,
} from './infrastructure/telemetry/telemetry-diagnostics';
import { registerTelemetrySdk } from './infrastructure/telemetry/telemetry-sdk.registry';
import {
  DEFAULT_EXPORT_TIMEOUT_MS,
  resolveExportTimeoutMs,
  resolveMetricExportTiming,
} from './infrastructure/telemetry/telemetry.constants';

const LOGS_EXPORTER_DISABLED = 'none';
const METRICS_TEMPORALITY_DELTA = 'delta';

export const telemetrySdk = startTelemetry();

function startTelemetry(): NodeSDK | undefined {
  // Without a destination address, nothing is registered: no instrumentation,
  // no exporter, no connection, no SDK module loaded. This is the switch — and
  // what keeps the E2E suites and local development free of a background
  // exporter.
  if (!process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim()) {
    return undefined;
  }

  // Node also runs `--require` preloads inside the module-hooks thread that
  // `registerEsmInstrumentationHook` spawns. Without this guard the preload
  // runs again there: it registers the hook twice (a raw warning on stderr)
  // and starts a second SDK, with its own exporters and the hooks thread's
  // runtime metrics reported as the service's.
  if (!isMainThread) {
    return undefined;
  }

  try {
    const sdk = createTelemetrySdk();

    // After the SDK is built, so a construction failure leaves no hooks thread
    // wrapping modules for instrumentations that never start.
    registerEsmInstrumentationHook();

    // Only the shutdown needs the instance, and it lives in a Nest hook: the
    // registry is the bridge, so the container does not import this module.
    // Before `start()` on purpose — if it fails halfway, what already started
    // still has to be flushed.
    registerTelemetrySdk(sdk);

    sdk.start();

    return sdk;
  } catch (error) {
    reportTelemetryFailure('startup', error);

    return undefined;
  }
}

// NestJS 12 is ESM-only and loads `express` through `import`, which the
// `require` hooks never see: without this loader the express spans, and
// `http.route` with them, disappear while every test stays green.
function registerEsmInstrumentationHook(): void {
  const { register } = require('node:module') as typeof import('node:module');
  const { pathToFileURL } = require('node:url') as typeof import('node:url');

  register('@opentelemetry/instrumentation/hook.mjs', pathToFileURL(__filename));
}

function createTelemetrySdk(): NodeSDK {
  const api = require('@opentelemetry/api') as typeof import('@opentelemetry/api');
  const { NodeSDK: Sdk } =
    require('@opentelemetry/sdk-node') as typeof import('@opentelemetry/sdk-node');
  const { OTLPTraceExporter } =
    require('@opentelemetry/exporter-trace-otlp-proto') as typeof import('@opentelemetry/exporter-trace-otlp-proto');
  const { OTLPMetricExporter } =
    require('@opentelemetry/exporter-metrics-otlp-proto') as typeof import('@opentelemetry/exporter-metrics-otlp-proto');
  const { PeriodicExportingMetricReader } =
    require('@opentelemetry/sdk-metrics') as typeof import('@opentelemetry/sdk-metrics');
  const { METRIC_VIEWS } =
    require('./infrastructure/telemetry/metric-registry') as typeof import('./infrastructure/telemetry/metric-registry');
  const { buildTelemetryResource } =
    require('./infrastructure/telemetry/telemetry-resource') as typeof import('./infrastructure/telemetry/telemetry-resource');

  applyPipelineDefaults();
  installDiagLogger(api);

  const timing = resolveMetricExportTiming();

  return new Sdk({
    resource: buildTelemetryResource(),
    traceExporter: new OTLPTraceExporter({
      timeoutMillis: resolveExportTimeoutMs(
        process.env.OTEL_EXPORTER_OTLP_TRACES_TIMEOUT ?? process.env.OTEL_EXPORTER_OTLP_TIMEOUT,
        DEFAULT_EXPORT_TIMEOUT_MS,
      ),
    }),
    metricReaders: [
      new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({
          timeoutMillis: resolveExportTimeoutMs(
            process.env.OTEL_EXPORTER_OTLP_METRICS_TIMEOUT ??
              process.env.OTEL_EXPORTER_OTLP_TIMEOUT,
            DEFAULT_EXPORT_TIMEOUT_MS,
          ),
        }),
        exportIntervalMillis: timing.intervalMillis,
        exportTimeoutMillis: timing.timeoutMillis,
      }),
    ],
    views: [...METRIC_VIEWS],
    instrumentations: buildInstrumentations(),
  });
}

/**
 * Installed **before** the `NodeSDK` constructor, with `OTEL_LOG_LEVEL` taken
 * out of its way. The constructor installs a `DiagConsoleLogger` on its own
 * when the variable is set, and the install call itself already **emits**
 * — measured, `@opentelemetry/api: Registered a global for diag` on **stdout**,
 * which here is a closed contract, one JSON object per line. Installing ours
 * afterwards came too late; installing it before without removing the variable
 * would be overwritten.
 *
 * The operator's intent is not lost: the variable is read here and controls the
 * level of this channel, capped at `WARN` because it never emits below that.
 */
function installDiagLogger(api: typeof import('@opentelemetry/api')): void {
  const level = resolveDiagLogLevel(api.DiagLogLevel);

  delete process.env.OTEL_LOG_LEVEL;

  api.diag.setLogger(createTelemetryDiagLogger(), level);
}

function resolveDiagLogLevel(
  levels: typeof import('@opentelemetry/api').DiagLogLevel,
): DiagLogLevel {
  const requested = process.env.OTEL_LOG_LEVEL?.trim().toLowerCase();

  if (requested === 'none') {
    return levels.NONE;
  }

  return requested === 'error' ? levels.ERROR : levels.WARN;
}

/**
 * Pipelines are declared, never inherited. The **absence** of `OTEL_LOGS_EXPORTER`
 * makes `NodeSDK` build a `LoggerProvider` with a network OTLP exporter:
 * nothing would feed it — logs have a single path, stdout —, but keeping an
 * exporter alive leaves the door open for a future configuration to start
 * feeding it without anyone deciding so.
 *
 */
function applyPipelineDefaults(): void {
  if (!process.env.OTEL_LOGS_EXPORTER?.trim()) {
    process.env.OTEL_LOGS_EXPORTER = LOGS_EXPORTER_DISABLED;
  }

  if (!process.env.OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE?.trim()) {
    process.env.OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE = METRICS_TEMPORALITY_DELTA;
  }
}

/**
 * Explicit list, never the metapackage: `auto-instrumentations-node` turns on
 * ~40 instrumentations and pays runtime surface and volume for libraries the
 * project does not use.
 *
 * `instrumentation-pino` stays out because the correlation is ours (see
 * `trace-correlation`), and `@prisma/instrumentation` because `PrismaService`
 * hands over an explicit `pg.Pool`: the driver is where the query actually runs.
 */
function buildInstrumentations() {
  const { AwsInstrumentation } =
    require('@opentelemetry/instrumentation-aws-sdk') as typeof import('@opentelemetry/instrumentation-aws-sdk');
  const { ExpressInstrumentation, ExpressLayerType } =
    require('@opentelemetry/instrumentation-express') as typeof import('@opentelemetry/instrumentation-express');
  const { HttpInstrumentation } =
    require('@opentelemetry/instrumentation-http') as typeof import('@opentelemetry/instrumentation-http');
  const { IORedisInstrumentation } =
    require('@opentelemetry/instrumentation-ioredis') as typeof import('@opentelemetry/instrumentation-ioredis');
  const { PgInstrumentation } =
    require('@opentelemetry/instrumentation-pg') as typeof import('@opentelemetry/instrumentation-pg');
  const { RuntimeNodeInstrumentation } =
    require('@opentelemetry/instrumentation-runtime-node') as typeof import('@opentelemetry/instrumentation-runtime-node');
  const { isIgnoredIncomingRequest } =
    require('./infrastructure/telemetry/incoming-request-filter') as typeof import('./infrastructure/telemetry/incoming-request-filter');
  const { buildIncomingSpanAttributes } =
    require('./infrastructure/telemetry/span-request-attributes') as typeof import('./infrastructure/telemetry/span-request-attributes');

  return [
    new HttpInstrumentation({
      // Health probes start no trace; the suppression also reaches their `pg` child spans.
      ignoreIncomingRequestHook: isIgnoredIncomingRequest,
      // Overwrites url.path, client.address and user_agent.original with the log's sanitized
      // values and drops url.query, so a span never carries data the log does not.
      startIncomingSpanHook: buildIncomingSpanAttributes,
    }),
    // One span per middleware (body parser, CORS, pino-http...) adds volume and no answer;
    // router and request handler layers stay, and they are what resolves `http.route`.
    new ExpressInstrumentation({ ignoreLayersType: [ExpressLayerType.MIDDLEWARE] }),
    new PgInstrumentation({
      // When on, the span gets the query parameter values: CPF, e-mail, phone.
      enhancedDatabaseReporting: false,
      // Without it every query outside a request becomes its own root trace: the outbox
      // relay polls every 500 ms per replica. Those queries also leave db.client metrics.
      requireParentSpan: true,
    }),
    // The SDK calls AWS over HTTPS: without this each SNS/SQS call also gets an HTTP client
    // child span that repeats the operation span. Trace context injection is not affected.
    new AwsInstrumentation({ suppressInternalInstrumentation: true }),
    // Command name only: the arguments carry the cached work order, with customer PII.
    new IORedisInstrumentation({ dbStatementSerializer: (command) => command }),
    new RuntimeNodeInstrumentation(),
  ];
}
