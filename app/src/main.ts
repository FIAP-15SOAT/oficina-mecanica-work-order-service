import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module';
import { configureApp, resolvePort } from './infrastructure/config/app-bootstrap';

import { TECHNICAL_EVENTS } from './infrastructure/logging/technical-event.catalog';
import { PinoLoggerAdapter } from './infrastructure/logging/pino-logger.adapter';
import { reportBootstrapFailure } from './infrastructure/logging/bootstrap-failure';

const FATAL_EXIT_GRACE_MS = 5_000;

async function bootstrap(): Promise<void> {
  const port = resolvePort(process.env.PORT);

  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });

  try {
    app.useLogger(app.get(Logger));

    const startupWarnings = configureApp(app, { withSwagger: true });

    app.enableShutdownHooks();

    await app.listen(port);

    logStartup(app, port, startupWarnings);
  } catch (error) {
    // Nest's `close()` runs the shutdown hooks in series and one of them
    // waits for Prisma's `$disconnect()` with no deadline: if it never
    // resolved, `bootstrap()` would never reject either, and the fatal line,
    // the exit code and the watchdog itself would never be armed.
    reportFatal(error);

    void app.close().catch(() => undefined);
  }
}

function logStartup(app: NestExpressApplication, port: number, warnings: string[]): void {
  const logger = app.get(PinoLoggerAdapter).forContext('Bootstrap');

  for (const warning of warnings) {
    logger.warn(warning);
  }

  logger.event(TECHNICAL_EVENTS.APPLICATION_STARTED, { port });
}

/**
 * `process.exitCode` instead of `process.exit()`: the exit code marks the
 * failure for the orchestrator to restart, and the process still ends on its
 * own when the event loop drains — without cutting the write of the line above,
 * which in a container goes to a pipe and is not always synchronous.
 *
 * The timer is the safety net for when the loop does **not** drain: a leftover
 * handle, or a shutdown hook that never resolves. It is `unref`'d on purpose,
 * so it does not hold the process on the healthy path and only fires if
 * something really kept it alive.
 */
function reportFatal(error: unknown): void {
  reportBootstrapFailure(error);

  process.exitCode = 1;

  setTimeout(() => process.exit(1), FATAL_EXIT_GRACE_MS).unref();
}

void bootstrap().catch(reportFatal);
