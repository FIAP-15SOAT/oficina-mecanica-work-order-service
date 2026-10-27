import { INestApplication, Type } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Logger } from 'nestjs-pino';
import { join } from 'path';
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
import { LocalstackContainer, StartedLocalStackContainer } from '@testcontainers/localstack';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { StartedValkeyContainer, ValkeyContainer } from '@testcontainers/valkey';
import type { Server } from 'http';
import { execSync } from 'child_process';
import { lookup } from 'dns/promises';
import type { DestinationStream } from 'pino';

import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/infrastructure/config/app-bootstrap';
import { PrismaService } from '../../src/infrastructure/persistence/prisma/prisma.service';
import { OutboxRelayService } from '../../src/infrastructure/messaging/outbox-relay.service';
import { SqsConsumerService } from '../../src/infrastructure/messaging/sqs-consumer.service';
import { LOGGER_DESTINATION, LOGGER_LEVEL } from '../../src/infrastructure/logging/logging.module';
import {
  CUSTOMER_JWT_TEST_PUBLIC_KEY,
  CUSTOMER_JWT_TEST_ISSUER,
  CUSTOMER_JWT_TEST_AUDIENCE,
} from './customer-jwt.helper';
import {
  STAFF_JWT_TEST_AUDIENCE,
  STAFF_JWT_TEST_ISSUER,
  STAFF_JWT_TEST_KEY_ID,
  STAFF_JWT_TEST_PRIVATE_KEY,
  STAFF_JWT_TEST_PUBLIC_KEY,
  STAFF_REFRESH_TEST_PRIVATE_KEY,
} from './staff-jwt.helper';

export interface LogCapture {
  lines(): Record<string, unknown>[];
  bootstrapLines(): Record<string, unknown>[];
  clear(): void;
}

export interface TestContext {
  app: INestApplication;
  httpServer: Server;
  prisma: PrismaService;
  postgresContainer: StartedPostgreSqlContainer;
  mailhogContainer: StartedTestContainer;
  valkeyContainer: StartedValkeyContainer;
  localstackContainer?: StartedLocalStackContainer;
  logCapture?: LogCapture;
}

export interface SetupTestAppOptions {
  captureLogs?: boolean;
  captureBootstrap?: boolean;
  withSwagger?: boolean;
  /**
   * Extension point run **before** `init()`, which is when Nest installs the
   * router. It exists for the log↔trace correlation suite: auto-instrumentation
   * does not run under Jest, so the server span is opened by a middleware of the
   * test itself — and it must be registered before `pino-http`, which registers
   * the completion listener.
   */
  configure?: (app: NestExpressApplication) => void;
  /** Extra controllers mounted next to AppModule, for routes that exist only in the test. */
  controllers?: Type[];
  /** Starts LocalStack with the messaging topology and runs the real relay and consumer. */
  withMessaging?: boolean;
}

interface LogCaptureSeam {
  destination: DestinationStream;
  capture: LogCapture;
  snapshotBootstrap(): void;
}

// nestjs-pino 5 builds one pino-http per process on first use, so a later app in the same suite
// keeps writing to the first app's destination: every capture shares it and redirects the sink.
// shortcut: the first app of a suite must capture logs, or later captures get nothing; route
// every app through this destination if a suite ever mixes them in the other order.
let activeSink: (line: string) => void = () => undefined;
const sharedDestination: DestinationStream = { write: (line: string) => activeSink(line) };

function createLogCapture(): LogCaptureSeam {
  let raw: string[] = [];
  let bootstrap: Record<string, unknown>[] = [];

  activeSink = (line) => {
    raw.push(line);
  };

  const parse = (lines: string[]): Record<string, unknown>[] =>
    lines
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as Record<string, unknown>);

  return {
    destination: sharedDestination,
    capture: {
      lines: () => parse(raw),
      bootstrapLines: () => bootstrap,
      clear: () => {
        raw = [];
      },
    },
    snapshotBootstrap: () => {
      bootstrap = parse(raw);
    },
  };
}

export async function setupTestApp(options: SetupTestAppOptions = {}): Promise<TestContext> {
  const postgresContainer = await new PostgreSqlContainer('postgres:18-alpine')
    .withDatabase('test_db')
    .withUsername('test')
    .withPassword('test')
    .start();

  const mailhogContainer = await new GenericContainer('mailhog/mailhog:v1.0.1')
    .withExposedPorts(1025, 8025)
    .start();

  const valkeyContainer = await new ValkeyContainer('valkey/valkey:9.1')
    .withPassword('test')
    .start();

  const localstackContainer = options.withMessaging
    ? await new LocalstackContainer('localstack/localstack:4.14.0')
        .withCopyFilesToContainer([
          {
            source: join(__dirname, '..', '..', 'localstack', 'init-topology.sh'),
            target: '/etc/localstack/init/ready.d/init-topology.sh',
            mode: 0o755,
          },
        ])
        .withWaitStrategy(Wait.forLogMessage('oficina-events.fifo topology ready'))
        .start()
    : undefined;

  if (localstackContainer) {
    process.env.AWS_ENDPOINT_URL = localstackContainer.getConnectionUri();
    process.env.AWS_REGION = 'us-east-1';
    process.env.AWS_ACCESS_KEY_ID = 'test';
    process.env.AWS_SECRET_ACCESS_KEY = 'test';
    process.env.WORK_ORDER_QUEUE_NAME = 'work-order.fifo';
    process.env.MESSAGING_TOPIC_ARN = 'arn:aws:sns:us-east-1:000000000000:oficina-events.fifo';
  }

  const databaseUrl = postgresContainer.getConnectionUri();

  process.env.DATABASE_URL = databaseUrl;
  // nodemailer resolves hostnames through DNS servers, not the hosts file: with 15 suites booting
  // at once a dropped query for "localhost" costs a 5 s retry and expires the 5 s Prisma transaction.
  process.env.MAIL_HOST = (await lookup(mailhogContainer.getHost(), { family: 4 })).address;
  process.env.MAIL_PORT = mailhogContainer.getMappedPort(1025).toString();
  process.env.CACHE_URL = valkeyContainer.getConnectionUrl();
  process.env.CACHE_TTL_SECONDS = '43200';
  process.env.STAFF_JWT_PRIVATE_KEY = STAFF_JWT_TEST_PRIVATE_KEY;
  process.env.STAFF_JWT_PUBLIC_KEY = STAFF_JWT_TEST_PUBLIC_KEY;
  process.env.STAFF_JWT_KEY_ID = STAFF_JWT_TEST_KEY_ID;
  process.env.STAFF_JWT_ISSUER = STAFF_JWT_TEST_ISSUER;
  process.env.STAFF_JWT_AUDIENCE = STAFF_JWT_TEST_AUDIENCE;
  process.env.STAFF_JWT_EXPIRATION = '10m';
  process.env.STAFF_JWT_REFRESH_PRIVATE_KEY = STAFF_REFRESH_TEST_PRIVATE_KEY;
  process.env.STAFF_JWT_REFRESH_EXPIRATION = '7d';
  process.env.CUSTOMER_JWT_PUBLIC_KEY = CUSTOMER_JWT_TEST_PUBLIC_KEY;
  process.env.CUSTOMER_JWT_ISSUER = CUSTOMER_JWT_TEST_ISSUER;
  process.env.CUSTOMER_JWT_AUDIENCE = CUSTOMER_JWT_TEST_AUDIENCE;

  execSync('npx prisma migrate deploy', {
    env: { ...process.env },
    cwd: join(__dirname, '..', '..'),
    stdio: 'pipe',
  });

  const builder = Test.createTestingModule({
    imports: [AppModule],
    controllers: options.controllers,
  });

  // Suites without a broker get an inert relay and consumer; the messaging suite runs the real ones.
  if (!localstackContainer) {
    builder.overrideProvider(OutboxRelayService).useValue({});
    builder.overrideProvider(SqsConsumerService).useValue({});
  }

  const captureLogs = options.captureLogs === true || options.captureBootstrap === true;
  const logCaptureSeam = captureLogs ? createLogCapture() : undefined;

  if (logCaptureSeam) {
    builder.overrideProvider(LOGGER_DESTINATION).useValue(logCaptureSeam.destination);
    builder.overrideProvider(LOGGER_LEVEL).useValue('trace');
  }

  const moduleFixture = await builder.compile();

  const app = moduleFixture.createNestApplication<NestExpressApplication>({
    bufferLogs: options.captureBootstrap === true,
  });

  if (options.captureBootstrap === true) {
    app.useLogger(app.get(Logger));
  }

  configureApp(app, { allowedOrigins: true, withSwagger: options.withSwagger === true });

  options.configure?.(app);

  await app.init();

  logCaptureSeam?.snapshotBootstrap();

  const prisma = moduleFixture.get(PrismaService);
  const httpServer = app.getHttpServer();

  return {
    app,
    httpServer,
    prisma,
    postgresContainer,
    mailhogContainer,
    valkeyContainer,
    localstackContainer,
    logCapture: logCaptureSeam?.capture,
  };
}

export async function teardownTestApp(ctx: TestContext): Promise<void> {
  if (ctx?.app) await ctx.app.close();
  if (ctx?.postgresContainer) await ctx.postgresContainer.stop();
  if (ctx?.mailhogContainer) await ctx.mailhogContainer.stop();
  if (ctx?.valkeyContainer) await ctx.valkeyContainer.stop();
  if (ctx?.localstackContainer) await ctx.localstackContainer.stop();
}
