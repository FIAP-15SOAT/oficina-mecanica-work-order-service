import { INestApplication } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Logger } from 'nestjs-pino';
import { join } from 'path';
import { GenericContainer, StartedTestContainer } from 'testcontainers';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { Server } from 'http';
import { execSync } from 'child_process';
import { lookup } from 'dns/promises';
import type { DestinationStream } from 'pino';

import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/infrastructure/config/app-bootstrap';
import { PrismaService } from '../../src/infrastructure/persistence/prisma/prisma.service';
import { LOGGER_DESTINATION, LOGGER_LEVEL } from '../../src/infrastructure/logging/logging.module';
import {
  CUSTOMER_JWT_TEST_PUBLIC_KEY,
  CUSTOMER_JWT_TEST_ISSUER,
  CUSTOMER_JWT_TEST_AUDIENCE,
} from './customer-jwt.helper';

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
  logCapture?: LogCapture;
}

export interface SetupTestAppOptions {
  captureLogs?: boolean;
  captureBootstrap?: boolean;
  withSwagger?: boolean;
  /**
   * Ponto de extensão executado **antes** de `init()`, que é quando o Nest
   * instala o roteador. Existe para a suíte de correlação log↔trace: a
   * instrumentação automática não roda sob Jest, então o span de servidor é
   * aberto por um middleware do próprio teste — e ele precisa ser registrado
   * antes do `pino-http`, que é quem registra o ouvinte de conclusão.
   */
  configure?: (app: NestExpressApplication) => void;
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
  const postgresContainer = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('test_db')
    .withUsername('test')
    .withPassword('test')
    .start();

  const mailhogContainer = await new GenericContainer('mailhog/mailhog')
    .withExposedPorts(1025, 8025)
    .start();

  const databaseUrl = postgresContainer.getConnectionUri();

  process.env.DATABASE_URL = databaseUrl;
  // nodemailer resolves hostnames through DNS servers, not the hosts file: with 15 suites booting
  // at once a dropped query for "localhost" costs a 5 s retry and expires the 5 s Prisma transaction.
  process.env.MAIL_HOST = (await lookup(mailhogContainer.getHost(), { family: 4 })).address;
  process.env.MAIL_PORT = mailhogContainer.getMappedPort(1025).toString();
  process.env.JWT_SECRET = 'test-jwt-secret-key-for-e2e';
  process.env.JWT_EXPIRATION = '15m';
  process.env.JWT_REFRESH_SECRET = 'test-jwt-refresh-secret-key-for-e2e';
  process.env.JWT_REFRESH_EXPIRATION = '7d';
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
  });

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
    logCapture: logCaptureSeam?.capture,
  };
}

export async function teardownTestApp(ctx: TestContext): Promise<void> {
  if (ctx?.app) await ctx.app.close();
  if (ctx?.postgresContainer) await ctx.postgresContainer.stop();
  if (ctx?.mailhogContainer) await ctx.mailhogContainer.stop();
}
