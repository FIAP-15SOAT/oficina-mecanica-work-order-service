import type { INestApplication } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { Server } from 'http';
import request from 'supertest';

import { LIVENESS_PATH, READINESS_PATH } from '@infrastructure/health/health.constants';
import { classifyHealthFailure } from '@infrastructure/health/postgres.health-check';
import { HealthFailureCategory } from '@infrastructure/logging/technical-event.catalog';
import { PrismaService } from '@infrastructure/persistence/prisma/prisma.service';

import { AppModule } from '../../src/app.module';
import { OutboxRelayService } from '../../src/infrastructure/messaging/outbox-relay.service';
import { SqsConsumerService } from '../../src/infrastructure/messaging/sqs-consumer.service';
import { configureApp } from '../../src/infrastructure/config/app-bootstrap';

import { AuthTokens, registerAndLogin } from '../helpers/auth.helper';
import { cleanDatabase } from '../helpers/db-cleanup.helper';
import { LogCapture, TestContext, setupTestApp } from '../helpers/test-app.helper';

const ACCESS_LOG_MESSAGE = 'http request';
const EVENT_NAME = 'oficina.event.name';

const HEALTH_FAILURE_CATEGORIES = [
  'timeout',
  'connection',
  'pool',
  'authentication',
  'query',
  'unknown',
];

function accessLines(capture: LogCapture): Record<string, unknown>[] {
  return capture.lines().filter((line) => line.message === ACCESS_LOG_MESSAGE);
}

function eventLines(capture: LogCapture, name: string): Record<string, unknown>[] {
  return capture.lines().filter((line) => line[EVENT_NAME] === name);
}

/**
 * `close(signal)` runs the shutdown hooks either way — `enableShutdownHooks()`
 * only registers process signal listeners, and the suite does not use it.
 * Nest's public interface does not declare the parameter, but
 * `NestApplicationContext` accepts it and passes it on to the hooks.
 */
function closeWithSignal(app: INestApplication, signal: string): Promise<void> {
  return (app as { close(signal?: string): Promise<void> }).close(signal);
}

interface ObservedFailure {
  code: unknown;
  message: unknown;
  category: HealthFailureCategory;
}

/**
 * Direct query to the stopped pool, through the same path the check uses, only
 * to **document the shape** the driver delivers. Without it an `unknown` on the
 * transition line says nothing: by security decision the event carries no driver
 * text, so the category assertion would fail without saying what changed.
 */
async function observeRawFailure(prisma: PrismaService): Promise<ObservedFailure> {
  let failure: unknown;

  try {
    await prisma.pool.query({ text: 'SELECT 1' });
  } catch (error) {
    failure = error;
  }

  if (failure === undefined) {
    throw new Error('a consulta direta ao banco parado não falhou');
  }

  const shape = failure as { code?: unknown; message?: unknown };

  return {
    code: shape.code,
    message: String(shape.message).slice(0, 160),
    category: classifyHealthFailure(failure),
  };
}

const READINESS_WARMUP_TIMEOUT_MS = 30_000;
const READINESS_WARMUP_INTERVAL_MS = 250;

/**
 * The **first** check after boot pays TCP + authentication with the pool still
 * empty, and its own deadline is 3.5 s. On a saturated machine — twelve E2E
 * suites, each with its own containers — that cold case misses the deadline and
 * readiness answers `503` once, exactly as it would in production before
 * `failureThreshold` is reached.
 *
 * The property is still asserted: if readiness **never** becomes `200`, this
 * function fails and takes the suite down. What it removes is the dependency on
 * a single cold sample under CPU starvation — cold-start latency is measured
 * separately, and what the tests below check is the **contract**.
 */
async function waitUntilReady(server: Server): Promise<void> {
  const deadline = Date.now() + READINESS_WARMUP_TIMEOUT_MS;

  for (;;) {
    const response = await request(server).get(READINESS_PATH);

    if (response.status === 200) {
      return;
    }

    if (Date.now() > deadline) {
      throw new Error(`prontidão não assentou em 200; último status: ${response.status}`);
    }

    await new Promise((resolve) => setTimeout(resolve, READINESS_WARMUP_INTERVAL_MS));
  }
}

describe('Health endpoints (E2E)', () => {
  let ctx: TestContext;
  let httpServer: Server;
  let capture: LogCapture;

  beforeAll(async () => {
    ctx = await setupTestApp({ captureLogs: true });
    httpServer = ctx.httpServer;
    capture = ctx.logCapture!;

    await waitUntilReady(httpServer);
  });

  /**
   * The app is closed by the last test, which needs to capture the lines of its
   * own shutdown.
   */
  afterAll(async () => {
    await ctx.postgresContainer.stop();
    await ctx.mailhogContainer.stop();
  });

  beforeEach(() => {
    capture.clear();
  });

  it('should answer liveness without credentials', async () => {
    const response = await request(httpServer).get(LIVENESS_PATH).expect(200);

    expect(response.body).toEqual({ status: 'ok' });
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('should answer readiness with the database up', async () => {
    const response = await request(httpServer).get(READINESS_PATH).expect(200);

    expect(response.body).toEqual({ status: 'ok' });
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it.each([LIVENESS_PATH, READINESS_PATH])(
    'should emit no access log line for a healthy probe on %s',
    async (path) => {
      await request(httpServer).get(path).expect(200);

      expect(accessLines(capture)).toHaveLength(0);
    },
  );

  it('should keep emitting the access log line for a business route', async () => {
    await request(httpServer).get('/api/customers').expect(401);

    expect(accessLines(capture)).toHaveLength(1);
  });

  it('should not silence a trailing-slash variant the router still accepts', async () => {
    await request(httpServer).get(`${LIVENESS_PATH}/`).expect(200);

    expect(accessLines(capture)).toHaveLength(1);
  });

  it('should emit no transition event while the dependency stays healthy', async () => {
    await request(httpServer).get(READINESS_PATH).expect(200);

    expect(eventLines(capture, 'health.degraded')).toHaveLength(0);
    expect(eventLines(capture, 'health.recovered')).toHaveLength(0);
  });

  /**
   * It must be the **last** test of the file's **first** `describe`, and both
   * conditions come from `nestjs-pino`: the logger outside a request context is
   * a module singleton (`outOfContext`, created only once), so the shutdown
   * lines of any later app land in this first one's capture. And the app must
   * be closed inside the test for the capture to see it.
   */
  it('should release the pool before announcing the shutdown as completed', async () => {
    await closeWithSignal(ctx.app, 'SIGTERM');

    const events = capture
      .lines()
      .map((line) => line[EVENT_NAME])
      .filter((name) => name === 'db.disconnected' || name === 'app.shutdown');

    expect(events).toEqual(['db.disconnected', 'app.shutdown']);
  });
});

describe('Health endpoints with the database unreachable (E2E)', () => {
  let ctx: TestContext;
  let httpServer: Server;
  let capture: LogCapture;
  let failureResponse: request.Response;
  let failureLines: Record<string, unknown>[];
  let observedFailure: ObservedFailure;

  beforeAll(async () => {
    ctx = await setupTestApp({ captureLogs: true });
    httpServer = ctx.httpServer;
    capture = ctx.logCapture!;

    await waitUntilReady(httpServer);

    await ctx.postgresContainer.stop();

    capture.clear();

    failureResponse = await request(httpServer).get(READINESS_PATH);
    failureLines = capture.lines();

    observedFailure = await observeRawFailure(ctx.prisma);
  });

  /**
   * Explicit order: after `stop()`, `close()` calls `$disconnect()` against a
   * dead server and that wait has no deadline, so it happens alone and first. A
   * later `stop()` is a no-op — testcontainers memoizes the stopped container —
   * which also means `restart()` is not a recovery path: the recovery
   * transition is covered by the unit spec.
   */
  afterAll(async () => {
    await ctx.app.close();
    await ctx.mailhogContainer.stop();
    await ctx.postgresContainer.stop();
  });

  it('should report unavailability on readiness while liveness stays successful', async () => {
    await request(httpServer).get(READINESS_PATH).expect(503);
    await request(httpServer).get(LIVENESS_PATH).expect(200);
  });

  it('should answer the same minimal body for the unavailable readiness', () => {
    expect(failureResponse.status).toBe(503);
    expect(failureResponse.body).toEqual({ status: 'unavailable' });
    expect(failureResponse.headers['cache-control']).toBe('no-store');
  });

  it('should not leak infrastructure detail in the unavailable body', () => {
    const body = JSON.stringify(failureResponse.body);

    expect(body).not.toMatch(/postgres|localhost|127\.0\.0\.1|5432|\bat\s/i);
    expect(body).not.toContain('Error');
    expect(body).not.toContain('prisma');
  });

  it('should emit exactly one access log line for the failing probe', () => {
    const lines = failureLines.filter((line) => line.message === ACCESS_LOG_MESSAGE);

    expect(lines).toHaveLength(1);
    expect(lines[0].level).toBe('error');
    expect(lines[0]['http.response.status_code']).toBe(503);
  });

  /**
   * The `503` response is deliberate and the handler does not throw, so there
   * is no resolved exception to derive the error attributes from — and
   * `pino-http` synthesizes an `Error` from the status, which the project
   * discards on purpose. The system does not fabricate them to fill the field.
   */
  it('should omit the error attributes and the stack trace on the deliberate failure', () => {
    const [line] = failureLines.filter((entry) => entry.message === ACCESS_LOG_MESSAGE);

    expect(line['error.type']).toBeUndefined();
    expect(line['oficina.error.message']).toBeUndefined();
    expect(line['exception.stacktrace']).toBeUndefined();
    expect(
      failureLines.filter((entry) => entry[EVENT_NAME] === 'http.request.failed'),
    ).toHaveLength(0);
  });

  it('should emit exactly one degradation event carrying the cause category', () => {
    const degraded = failureLines.filter((line) => line[EVENT_NAME] === 'health.degraded');

    expect(degraded).toHaveLength(1);
    expect(degraded[0].level).toBe('warn');
    expect(degraded[0]['oficina.dependency.name']).toBe('postgresql');
    expect(HEALTH_FAILURE_CATEGORIES).toContain(degraded[0]['oficina.health.failure.category']);

    // A stopped container produces `ECONNREFUSED` — direct or aggregated by
    // address family — or a `pg` `Error` with a constant message. All of them
    // classify as `connection`, never as `unknown`.
    expect(degraded[0]['oficina.health.failure.category']).toBe('connection');
  });

  /**
   * Asserts on the whole object on purpose: on a mismatch Jest prints the
   * observed `code` and message, which is the information needed to fix the
   * mapping without another full run of the suite.
   */
  it('should classify the shape the driver actually produces for a dead server', () => {
    expect(observedFailure).toMatchObject({ category: 'connection' });
  });

  it('should not repeat the degradation event while the state does not change', async () => {
    capture.clear();

    await request(httpServer).get(READINESS_PATH).expect(503);
    await request(httpServer).get(READINESS_PATH).expect(503);

    expect(eventLines(capture, 'health.degraded')).toHaveLength(0);
  });

  it('should not leak infrastructure detail in the degradation event', () => {
    const [degraded] = failureLines.filter((line) => line[EVENT_NAME] === 'health.degraded');

    expect(JSON.stringify(degraded)).not.toMatch(/5432|Can't reach|connection string/i);
  });
});

describe('Health endpoints during graceful shutdown (E2E)', () => {
  let ctx: TestContext;
  let httpServer: Server;
  let previousEnvironment: string | undefined;

  beforeEach(async () => {
    // The window is held only where a data plane exists to propagate the
    // removal — outside one it would just be hot-reload latency. Declaring the
    // environment here is what makes this suite exercise the orchestrated behavior.
    previousEnvironment = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    ctx = await setupTestApp();
    httpServer = ctx.httpServer;

    // The window is held only on a real signal, and the server must really be
    // listening for a request to cross the shutdown.
    await ctx.app.listen(0);
    await cleanDatabase(ctx.prisma);
    await waitUntilReady(httpServer);
  });

  afterEach(async () => {
    process.env.NODE_ENV = previousEnvironment;

    await ctx.postgresContainer.stop();
    await ctx.mailhogContainer.stop();
  });

  it('should report unavailable readiness and successful liveness during the window', async () => {
    const closing = closeWithSignal(ctx.app, 'SIGTERM');

    await request(httpServer).get(READINESS_PATH).expect(503);
    await request(httpServer).get(LIVENESS_PATH).expect(200);

    await closing;
  });

  /**
   * The **only** test that proves the order in which resources are released.
   * The status test above does not: with `$disconnect()` back in
   * `onModuleDestroy`, `/ready` would answer `503` from the `draining` state
   * and `/live` `200` either way, and both would pass. Here the real database
   * query happens **after** shutdown starts, so it fails if the pool was closed
   * before the window.
   */
  it('should let an in-flight business request reach the database during the window', async () => {
    const auth: AuthTokens = await registerAndLogin(
      httpServer,
      { name: 'Admin Drain', email: 'admin.drain@e2e.test', role: 'ADMIN' },
      ctx.prisma,
    );

    const created = await request(httpServer)
      .post('/api/services')
      .set('Authorization', `Bearer ${auth.accessToken}`)
      .send({ name: 'Troca de óleo drain', basePrice: 150.5, estimatedTimeMin: 45 })
      .expect(201);

    const serviceId = created.body.data.id as string;

    const delegate = ctx.prisma.service as unknown as {
      findUnique: (args: unknown) => Promise<unknown>;
    };
    const findUnique = delegate.findUnique.bind(ctx.prisma.service);

    let handlerReached!: () => void;
    const reached = new Promise<void>((resolve) => {
      handlerReached = resolve;
    });

    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });

    delegate.findUnique = async (args: unknown) => {
      handlerReached();

      await released;

      return findUnique(args);
    };

    const inFlight = request(httpServer)
      .get(`/api/services/${serviceId}`)
      .set('Authorization', `Bearer ${auth.accessToken}`)
      .then((response) => response);

    await reached;

    const closing = closeWithSignal(ctx.app, 'SIGTERM');

    release();

    const response = await inFlight;

    expect(response.status).toBe(200);
    expect(response.body.data.id).toBe(serviceId);

    delegate.findUnique = findUnique;

    await closing;
  });
});

/**
 * An address that refuses the connection immediately. The goal is not to measure
 * latency, but to prove the port opens with the database unreachable **from boot**.
 */
const UNREACHABLE_DATABASE_URL = 'postgresql://nobody:nobody@127.0.0.1:1/nodb';

/**
 * Boots the application with no infrastructure at all — no containers, no
 * migration. The edge composition comes from `configureApp()`, the same one
 * `main.ts` uses, so the sequence is not duplicated by hand and does not drift
 * again — and so does `listen()`: "the port opens with the database down" is
 * the property this `describe` exists to prove, and without really listening
 * there is no port to assert.
 */
async function bootWithoutDatabase(): Promise<NestExpressApplication> {
  // No broker here either: relay and consumer are inert, as in setupTestApp.
  const moduleFixture = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(OutboxRelayService)
    .useValue({})
    .overrideProvider(SqsConsumerService)
    .useValue({})
    .compile();
  const app = moduleFixture.createNestApplication<NestExpressApplication>();

  configureApp(app, { allowedOrigins: true, withSwagger: true });

  await app.init();
  await app.listen(0);

  return app;
}

describe('Health endpoints with the database unavailable from boot (E2E)', () => {
  let app: NestExpressApplication;
  let httpServer: Server;
  let previousDatabaseUrl: string | undefined;

  beforeAll(async () => {
    previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = UNREACHABLE_DATABASE_URL;

    app = await bootWithoutDatabase();
    httpServer = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();

    process.env.DATABASE_URL = previousDatabaseUrl;
  });

  /**
   * The cloud-native property the design depends on and no other test covered:
   * the adapter's `$connect()` is lazy, so a pod created with the database down
   * **starts**, passes the `startupProbe` and recovers on its own. If a future
   * adapter version starts checking connectivity in `connect()`, this becomes
   * `CrashLoopBackOff` in production — and fails here first.
   */
  it('should open the port even though the database is unreachable', () => {
    expect(httpServer.listening).toBe(true);
    expect(httpServer.address()).not.toBeNull();
  });

  it('should answer liveness with success while the database is unreachable', async () => {
    const response = await request(httpServer).get(LIVENESS_PATH).expect(200);

    expect(response.body).toEqual({ status: 'ok' });
  });

  it('should answer readiness with unavailability while the database is unreachable', async () => {
    const response = await request(httpServer).get(READINESS_PATH).expect(503);

    expect(response.body).toEqual({ status: 'unavailable' });
    expect(response.headers['cache-control']).toBe('no-store');
  });

  /**
   * The published contract feeds the DAST scan and generated clients. A single
   * schema with both values would claim that `/live` can answer `unavailable`
   * and that the `503` can answer `ok` — states that do not exist, and that
   * would lead a consumer to read the body instead of the status.
   */
  describe('published contract', () => {
    let paths: Record<string, Record<string, { responses: Record<string, unknown> }>>;
    let schemas: Record<string, { properties: { status: { enum: unknown } } }>;

    // Swagger publishes the body as a `$ref` to `components.schemas`, so the
    // assertion must resolve the reference to reach the real enum.
    const enumOf = (response: unknown): unknown => {
      const { $ref } = (
        response as { content: { 'application/json': { schema: { $ref: string } } } }
      ).content['application/json'].schema;

      return schemas[$ref.split('/').pop()!].properties.status.enum;
    };

    beforeAll(async () => {
      const document = await request(httpServer).get('/api/docs-json').expect(200);

      paths = document.body.paths as typeof paths;
      schemas = document.body.components.schemas as typeof schemas;
    });

    it('should publish both health paths', () => {
      expect(Object.keys(paths)).toEqual(expect.arrayContaining([LIVENESS_PATH, READINESS_PATH]));
    });

    it('should not declare an unavailable outcome for liveness', () => {
      const responses = paths[LIVENESS_PATH].get.responses;

      expect(Object.keys(responses)).not.toContain('503');
      expect(enumOf(responses['200'])).toEqual(['ok']);
    });

    it('should declare one body per readiness outcome', () => {
      const responses = paths[READINESS_PATH].get.responses;

      expect(enumOf(responses['200'])).toEqual(['ok']);
      expect(enumOf(responses['503'])).toEqual(['unavailable']);
    });
  });
});
