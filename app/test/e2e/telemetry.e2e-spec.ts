import type { Server } from 'http';
import { context, metrics, trace } from '@opentelemetry/api';
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
  ResourceMetrics,
} from '@opentelemetry/sdk-metrics';
import {
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-node';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import request from 'supertest';

import { DECLARED_FIELD_NAMES } from '@infrastructure/logging/field-registry';
import { METRIC_VIEWS } from '@infrastructure/telemetry/metric-registry';

import { AuthTokens, registerAndLogin } from '../helpers/auth.helper';
import { cleanDatabase } from '../helpers/db-cleanup.helper';
import { LogCapture, TestContext, setupTestApp, teardownTestApp } from '../helpers/test-app.helper';

const ACCESS_LOG_MESSAGE = 'http request';

const TEST_SPAN_NAME = 'e2e server span';

/**
 * ⚠️ Auto-instrumentation **does not work under Jest**: `jest-runtime` has its
 * own module registry and does not go through Node's loader, which is where
 * `require-in-the-middle` hooks in. A test asserting something about spans
 * produced by instrumentation would stay green **without checking anything** —
 * and an empty test is worse than no test, because it buys confidence.
 *
 * What this suite checks is what **is ours** and works without patching: the
 * correlation `mixin` reading the active span, the three fields surviving the
 * output normalizer, and business metrics emitted end to end with a real
 * PostgreSQL. The server span is opened by the test's own middleware, which
 * reproduces what `instrumentation-http` does — including the response's
 * `context.bind`, without which `pino-http`'s completion listener would run
 * outside the context and `trace_id` would vanish from the access log line.
 *
 * Real server spans, the parameterized `http.route`, probe exclusion and the
 * absence of `url.query` are checked in the smoke test outside Jest, over the
 * compose stack, which runs the real `CMD` with the preload.
 */
function openServerSpan(app: NestExpressApplication): void {
  app.use((req: Request, res: Response, next: NextFunction) => {
    const span = trace.getTracer('e2e').startSpan(TEST_SPAN_NAME);
    const spanContext = trace.setSpan(context.active(), span);

    context.with(spanContext, () => {
      context.bind(spanContext, req);
      context.bind(spanContext, res);

      res.on('finish', () => span.end());

      next();
    });
  });
}

describe('Telemetry (E2E)', () => {
  let ctx: TestContext;
  let httpServer: Server;
  let capture: LogCapture;
  let adminAuth: AuthTokens;
  let spanExporter: InMemorySpanExporter;
  let tracerProvider: NodeTracerProvider;
  let meterProvider: MeterProvider;
  let collect: () => Promise<ResourceMetrics>;

  beforeAll(async () => {
    spanExporter = new InMemorySpanExporter();
    tracerProvider = new NodeTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(spanExporter)],
    });
    tracerProvider.register();

    const metricExporter = new InMemoryMetricExporter(AggregationTemporality.DELTA);
    const reader = new PeriodicExportingMetricReader({
      exporter: metricExporter,
      exportIntervalMillis: 600_000,
      exportTimeoutMillis: 5_000,
    });
    meterProvider = new MeterProvider({ readers: [reader], views: [...METRIC_VIEWS] });

    // Before `setupTestApp`: the adapter resolves the `Meter` in its
    // constructor, and the injection container builds it during initialization.
    metrics.setGlobalMeterProvider(meterProvider);
    collect = async () => (await reader.collect()).resourceMetrics;

    ctx = await setupTestApp({ captureBootstrap: true, configure: openServerSpan });
    httpServer = ctx.httpServer;
    capture = ctx.logCapture!;
  });

  afterAll(async () => {
    await teardownTestApp(ctx);
    await meterProvider.shutdown();
    await tracerProvider.shutdown();
    metrics.disable();
    context.disable();
    trace.disable();
  });

  beforeEach(async () => {
    await cleanDatabase(ctx.prisma);
    adminAuth = await registerAndLogin(
      httpServer,
      { name: 'Admin Telemetria', email: 'admin.telemetria@e2e.test', role: 'ADMIN' },
      ctx.prisma,
    );
    capture.clear();
    spanExporter.reset();
    // Drain the delta window so each test starts from zero.
    await collect();
  });

  function accessLines(): Record<string, unknown>[] {
    return capture.lines().filter((line) => line.message === ACCESS_LOG_MESSAGE);
  }

  describe('log↔trace correlation', () => {
    it('should carry trace_id, span_id and request.id on the same access log line', async () => {
      await request(httpServer)
        .get('/api/customers')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(200);

      const [line] = accessLines();
      const [span] = spanExporter.getFinishedSpans();

      expect(span.name).toBe(TEST_SPAN_NAME);
      expect(line['trace_id']).toBe(span.spanContext().traceId);
      expect(line['span_id']).toBe(span.spanContext().spanId);
      expect(line['trace_flags']).toBe('01');

      // `request.id` stays: it is the key that also exists outside a span, is
      // echoed in the response header and is the one a user quotes in a ticket.
      expect(line['request.id']).toEqual(expect.any(String));
    });

    it('should keep the identifiers stable within the same request', async () => {
      await request(httpServer)
        .get('/api/customers')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(200);

      const traceIds = new Set(capture.lines().map((line) => line['trace_id']));

      expect(traceIds.size).toBe(1);
      expect([...traceIds][0]).toBeDefined();
    });

    /**
     * An empty or synthetic identifier is worse than no field: it would make
     * the destination try to correlate with a trace that does not exist.
     */
    it('should not emit trace fields on bootstrap lines, which live outside any span', () => {
      const bootstrapLines = capture.bootstrapLines();

      expect(bootstrapLines.length).toBeGreaterThan(0);

      for (const line of bootstrapLines) {
        expect(line).not.toHaveProperty('trace_id');
        expect(line).not.toHaveProperty('span_id');
        expect(line).not.toHaveProperty('trace_flags');
      }
    });

    /**
     * Without a dictionary declaration, `normalizeLogRecord` would drop all
     * three silently — a correlation promised and not delivered.
     */
    it('should keep the dictionary closed with the three new fields', async () => {
      await request(httpServer)
        .get('/api/customers')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(200);

      const lines = capture.lines();
      const undeclared = lines
        .flatMap((line) => Object.keys(line))
        .filter((key) => !DECLARED_FIELD_NAMES.has(key));

      expect(undeclared).toEqual([]);
      expect(DECLARED_FIELD_NAMES.has('trace_id')).toBe(true);
      expect(DECLARED_FIELD_NAMES.has('span_id')).toBe(true);
      expect(DECLARED_FIELD_NAMES.has('trace_flags')).toBe(true);
    });

    it('should declare the three fields as strings, as the dictionary promises', async () => {
      await request(httpServer)
        .get('/api/customers')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(200);

      const [line] = accessLines();

      expect(typeof line['trace_id']).toBe('string');
      expect(typeof line['span_id']).toBe('string');
      expect(typeof line['trace_flags']).toBe('string');
    });
  });

  describe('business metrics', () => {
    let customerCounter = 0;

    function generateCPF(seed: number): string {
      const base = String(seed).padStart(9, '0');
      const digits = base.split('').map(Number);
      let first = digits.reduce((total, value, index) => total + value * (10 - index), 0);
      first = 11 - (first % 11);
      if (first >= 10) first = 0;
      digits.push(first);
      let second = digits.reduce((total, value, index) => total + value * (11 - index), 0);
      second = 11 - (second % 11);
      if (second >= 10) second = 0;
      digits.push(second);

      return digits.join('');
    }

    function authorized(method: 'post' | 'patch' | 'get', path: string) {
      return request(httpServer)
        [method](path)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`);
    }

    async function createWorkOrder(): Promise<string> {
      const id = ++customerCounter;

      const customer = await authorized('post', '/api/customers')
        .send({
          name: `Cliente Telemetria ${id}`,
          document: generateCPF(id),
          type: 'INDIVIDUAL',
          email: `cliente.telemetria${Date.now()}${id}@test.com`,
          phone: '11999999999',
          address: {
            street: 'Rua Teste, 123',
            city: 'São Paulo',
            state: 'SP',
            zipCode: '01310-100',
          },
        })
        .expect(201);

      const vehicle = await authorized('post', '/api/vehicles')
        .send({
          customerId: customer.body.data.id,
          plate: `TEL-${Date.now().toString().slice(-4)}`,
          brand: 'Toyota',
          model: 'Corolla',
          year: 2020,
        })
        .expect(201);

      const workOrder = await authorized('post', '/api/work-orders')
        .send({
          customerId: customer.body.data.id,
          vehicleId: vehicle.body.data.id,
          problemDescription: 'Revisão geral',
        })
        .expect(201);

      return workOrder.body.data.id as string;
    }

    async function createServiceItem(): Promise<string> {
      const service = await authorized('post', '/api/services')
        .send({
          name: `Troca de óleo ${Date.now()}${++customerCounter}`,
          basePrice: 150,
          estimatedTimeMin: 30,
        })
        .expect(201);

      return service.body.data.id as string;
    }

    async function submitQuote(workOrderId: string, serviceId: string): Promise<string> {
      const quote = await authorized('post', '/api/quotes').send({ workOrderId }).expect(201);
      const quoteId = quote.body.data.id as string;

      await authorized('post', `/api/quotes/${quoteId}/services`)
        .send({ serviceId, quantity: 1 })
        .expect(200);

      await authorized('post', `/api/quotes/${quoteId}/submissions`).send({}).expect(200);

      return quoteId;
    }

    interface CollectedPoint {
      value: unknown;
      attributes: Record<string, unknown>;
    }

    /**
     * The reader exports with **delta** temporality, so each collection drains
     * the window: collecting twice in the same test would return the second
     * empty. The suite takes **one** snapshot and queries it.
     */
    async function takeSnapshot(): Promise<(name: string) => CollectedPoint[]> {
      const resourceMetrics = await collect();

      return (name: string) =>
        resourceMetrics.scopeMetrics
          .flatMap((scope) => scope.metrics)
          .filter((metric) => metric.descriptor.name === name)
          .flatMap((metric) => metric.dataPoints as unknown as CollectedPoint[]);
    }

    function dwellStatuses(points: (name: string) => CollectedPoint[]): string[] {
      return points('oficina.work_order.status.duration').map((point) =>
        String(point.attributes['oficina.work_order.status']),
      );
    }

    it('should count the creation and measure every step of a full cycle up to delivery', async () => {
      const workOrderId = await createWorkOrder();
      const serviceId = await createServiceItem();

      await authorized('patch', `/api/work-orders/${workOrderId}`)
        .send({ status: 'IN_DIAGNOSIS' })
        .expect(200);

      const quoteId = await submitQuote(workOrderId, serviceId);

      await authorized('patch', `/api/quotes/${quoteId}`).send({ status: 'APPROVED' }).expect(200);

      await authorized('patch', `/api/work-orders/${workOrderId}/services/${serviceId}`)
        .send({ status: 'IN_PROGRESS' })
        .expect(200);

      await authorized('patch', `/api/work-orders/${workOrderId}/services/${serviceId}`)
        .send({ status: 'COMPLETED' })
        .expect(200);

      await authorized('patch', `/api/work-orders/${workOrderId}`)
        .send({ status: 'DELIVERED' })
        .expect(200);

      const points = await takeSnapshot();

      expect(points('oficina.work_order.created')[0].value).toBe(1);

      // Every status with an outgoing transition produces an observation: that
      // is what makes the sum of the stages match the total service time.
      expect(dwellStatuses(points).sort()).toEqual([
        'APPROVED',
        'AWAITING_APPROVAL',
        'COMPLETED',
        'IN_DIAGNOSIS',
        'IN_PROGRESS',
        'RECEIVED',
      ]);

      expect(points('oficina.work_order.diagnosis_to_completion.duration')).toHaveLength(1);
      expect(points('oficina.work_order.lead_time.duration')).toHaveLength(1);
    });

    it('should measure the wait in REJECTED when there is a rejection and a new quote', async () => {
      const workOrderId = await createWorkOrder();
      const serviceId = await createServiceItem();

      await authorized('patch', `/api/work-orders/${workOrderId}`)
        .send({ status: 'IN_DIAGNOSIS' })
        .expect(200);

      const firstQuote = await submitQuote(workOrderId, serviceId);

      await authorized('patch', `/api/quotes/${firstQuote}`)
        .send({ status: 'REJECTED', reason: 'Cliente pediu nova proposta' })
        .expect(200);

      const secondQuote = await submitQuote(workOrderId, serviceId);

      await authorized('patch', `/api/quotes/${secondQuote}`)
        .send({ status: 'APPROVED' })
        .expect(200);

      const points = await takeSnapshot();

      expect(dwellStatuses(points)).toContain('REJECTED');

      // Re-entry: the histogram aggregates by attribute set, so the two passes
      // through `AWAITING_APPROVAL` become **two observations** in the same
      // point — never one, accumulated since the first entry. That each
      // observation covers only its own pass is what the
      // `measureWorkOrderDurations` unit spec pins down.
      const awaitingApproval = points('oficina.work_order.status.duration').find(
        (point) => point.attributes['oficina.work_order.status'] === 'AWAITING_APPROVAL',
      );

      expect((awaitingApproval?.value as { count: number }).count).toBe(2);
    });

    /**
     * Cancelling is not taking long: including the cancelled order in the
     * totals would mix "took long" with "did not happen".
     */
    it('should not produce any total when the order is cancelled midway', async () => {
      const workOrderId = await createWorkOrder();

      await authorized('patch', `/api/work-orders/${workOrderId}`)
        .send({ status: 'IN_DIAGNOSIS' })
        .expect(200);

      await authorized('patch', `/api/work-orders/${workOrderId}`)
        .send({ status: 'CANCELLED', notes: 'Cliente desistiu' })
        .expect(200);

      const points = await takeSnapshot();

      expect(dwellStatuses(points).sort()).toEqual(['IN_DIAGNOSIS', 'RECEIVED']);
      expect(points('oficina.work_order.diagnosis_to_completion.duration')).toHaveLength(0);
      expect(points('oficina.work_order.lead_time.duration')).toHaveLength(0);
    });

    it('should not count any order when the creation is rejected', async () => {
      await authorized('post', '/api/work-orders')
        .send({ customerId: 'nao-e-uuid', vehicleId: 'nao-e-uuid' })
        .expect(400);

      expect((await takeSnapshot())('oficina.work_order.created')).toHaveLength(0);
    });
  });
});
