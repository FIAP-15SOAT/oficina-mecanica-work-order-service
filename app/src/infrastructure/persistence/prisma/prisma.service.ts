import { Inject, Injectable, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@generated/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

import { ILogger } from '@application/ports/output/services/logger.service.interface';
import { TECHNICAL_EVENTS } from '@infrastructure/logging/technical-event.catalog';

/**
 * Bounds connection **acquisition**, the only part the readiness check cannot
 * bound per query. Without it the default is `0` — wait forever —, and the
 * single readiness slot, released only when the operation settles, would keep
 * the replica not-ready until TCP gives up.
 */
const CONNECTION_TIMEOUT_MS = 3_000;

const KEEP_ALIVE_INITIAL_DELAY_MS = 10_000;

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnApplicationShutdown {
  /**
   * The pool is built here and exposed on purpose: the readiness check needs a
   * **per-query** deadline (`query_timeout`), which Prisma does not pass along,
   * and must measure **this** pool — the same one the business routes use — so
   * per-replica saturation stays detectable. A separate pool just for the probe
   * would measure something else.
   */
  readonly pool: Pool;

  private readonly logger: ILogger;

  constructor(@Inject('ILogger') logger: ILogger) {
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL!,
      connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
      keepAlive: true,
      keepAliveInitialDelayMillis: KEEP_ALIVE_INITIAL_DELAY_MS,
    });

    // `disposeExternalPool` makes the adapter's `dispose()` call `pool.end()`,
    // so `$disconnect()` remains the single shutdown point.
    super({ adapter: new PrismaPg(pool, { disposeExternalPool: true }) });

    this.pool = pool;
    this.logger = logger.forContext(PrismaService.name);
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.$connect();
    } catch (error) {
      this.logger.event(TECHNICAL_EVENTS.DATABASE_CONNECTION_FAILED, {}, error);

      throw error;
    }

    this.logger.event(TECHNICAL_EVENTS.DATABASE_CONNECTED, {});
  }

  /**
   * `onApplicationShutdown`, **not** `onModuleDestroy`. Nest's `close()` runs
   * `callDestroyHook` → `callBeforeShutdownHook` → `dispose` →
   * `callShutdownHook`, that is: `onModuleDestroy` runs before the drain window
   * and before the HTTP server stops accepting connections. Disconnecting there
   * would leave the pod accepting traffic with the pool already closed, turning
   * "drop an in-flight request" into "answer an error" — worse than no drain.
   * Here the disconnect happens after the server closes, when there is no
   * request left to serve.
   */
  async onApplicationShutdown(): Promise<void> {
    await this.$disconnect();

    this.logger.event(TECHNICAL_EVENTS.DATABASE_DISCONNECTED, {});
  }
}
