import { Injectable, OnApplicationShutdown } from '@nestjs/common';

import { reportTelemetryFailure } from './telemetry-diagnostics';
import { getTelemetrySdk } from './telemetry-sdk.registry';
import { TELEMETRY_SHUTDOWN_TIMEOUT_MS } from './telemetry.constants';

/**
 * `onApplicationShutdown`, not `onModuleDestroy`, for the same reason as Prisma:
 * Nest runs `callDestroyHook -> callBeforeShutdownHook -> dispose ->
 * callShutdownHook`, and flushing before the drain window would export the
 * spans of requests still being served.
 */
@Injectable()
export class TelemetryLifecycleService implements OnApplicationShutdown {
  async onApplicationShutdown(): Promise<void> {
    const sdk = getTelemetrySdk();

    if (!sdk) {
      return;
    }

    try {
      await withShutdownDeadline(sdk.shutdown());
    } catch (error) {
      // A flush failure never stops the process from ending nor the following
      // hooks from running.
      reportTelemetryFailure('shutdown', error);
    }
  }
}

function withShutdownDeadline(pending: Promise<void>): Promise<void> {
  let timer: NodeJS.Timeout | undefined;

  const deadline = new Promise<void>((resolve) => {
    // `unref` so the timer does not hold the process on the healthy path.
    timer = setTimeout(resolve, TELEMETRY_SHUTDOWN_TIMEOUT_MS);
    timer.unref();
  });

  return Promise.race([pending, deadline]).finally(() => clearTimeout(timer));
}
