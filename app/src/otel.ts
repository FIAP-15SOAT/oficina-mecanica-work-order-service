/* eslint-disable @typescript-eslint/no-require-imports --
 * Os módulos do SDK são carregados **dentro** de `startTelemetry`, depois do
 * interruptor. Com `import` de topo, o preload pagava o SDK inteiro mesmo com a telemetria desligada
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
  // Sem endereço de destino, nada é registrado: nenhuma instrumentação, nenhum
  // exportador, nenhuma conexão, nenhum módulo do SDK carregado. É o
  // interruptor — e o que mantém as suítes E2E e o desenvolvimento local sem
  // exportador de fundo.
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

    // Só o encerramento precisa da instância, e ele vive num hook do Nest: o
    // registro é a ponte, para que o contêiner não importe este módulo. Antes
    // do `start()` de propósito — se ele falhar no meio, o que já subiu ainda
    // precisa ser descarregado.
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
 * Instalado **antes** do construtor do `NodeSDK`, e com `OTEL_LOG_LEVEL` tirada
 * do caminho dele. O construtor instala um `DiagConsoleLogger` por conta própria
 * quando a variável está definida, e a própria chamada de instalação já **emite**
 * — medido, `@opentelemetry/api: Registered a global for diag` em **stdout**,
 * que aqui é contrato fechado, um objeto JSON por linha. Instalar o nosso depois
 * chegava tarde; instalar antes sem remover a variável seria sobrescrito.
 *
 * A intenção do operador não se perde: a variável é lida aqui e passa a controlar
 * o nível deste canal, com teto em `WARN` porque ele nunca emite abaixo disso.
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
 * Pipelines declarados, nunca herdados. A **ausência** de `OTEL_LOGS_EXPORTER`
 * faz o `NodeSDK` instanciar um `LoggerProvider` com exportador OTLP de rede:
 * nada o alimentaria — os logs têm um caminho único, stdout —, mas manter um
 * exportador vivo deixa a porta aberta para que uma configuração futura passe a
 * alimentá-lo sem que ninguém decida isso.
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
 * Lista explícita, nunca o metapacote: `auto-instrumentations-node` liga ~40
 * instrumentações e paga superfície de runtime e volume por bibliotecas que o
 * projeto não usa.
 *
 * `instrumentation-pino` fica fora porque a correlação é nossa (ver
 * `trace-correlation`), e `@prisma/instrumentation` porque o `PrismaService`
 * entrega um `pg.Pool` explícito: o driver é onde a consulta de fato acontece.
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
