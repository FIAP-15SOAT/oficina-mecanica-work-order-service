import { BeforeApplicationShutdown, Inject, Injectable } from '@nestjs/common';

import { ILogger } from '@application/ports/output/logger.service.interface';
import { TECHNICAL_EVENTS } from '@infrastructure/logging/technical-event.catalog';

import {
  HealthCheckResult,
  POSTGRES_DEPENDENCY_NAME,
  PostgresHealthCheck,
  withDeadline,
} from './postgres.health-check';

export const DRAIN_WINDOW_MS = 10_000;

const TERMINATION_SIGNALS: ReadonlySet<string> = new Set(['SIGTERM', 'SIGINT']);

const ORCHESTRATED_ENVIRONMENT = 'production';

/**
 * The window is only held where a data plane exists to propagate the removal.
 * Outside it, it is pure cost: `nest start --watch` kills the process with
 * `SIGTERM` and only respawns on `exit`, so every hot reload on Linux/macOS
 * would pay the 10 s (not on Windows, because `tree-kill` uses `taskkill /F` —
 * which makes the regression invisible to whoever develops there).
 */
export function isDrainWindowEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === ORCHESTRATED_ENVIRONMENT;
}

@Injectable()
export class ReadinessState implements BeforeApplicationShutdown {
  private readonly logger: ILogger;

  private pending?: Promise<HealthCheckResult>;

  private draining = false;

  private degradedSince?: number;

  constructor(
    private readonly check: PostgresHealthCheck,
    @Inject('ILogger') logger: ILogger,
  ) {
    this.logger = logger.forContext(ReadinessState.name);
  }

  async isReady(): Promise<boolean> {
    if (this.draining) {
      return false;
    }

    const result = await withDeadline(this.runExclusively());

    // Checked again, and **before** applying the result: the termination signal
    // may have arrived while the check ran, and a check started before it must
    // not restore `ready` nor emit a recovery.
    if (this.draining) {
      return false;
    }

    this.recordTransition(result);

    return result.healthy;
  }

  async beforeApplicationShutdown(signal?: string): Promise<void> {
    this.draining = true;

    if (signal === undefined || !TERMINATION_SIGNALS.has(signal) || !isDrainWindowEnabled()) {
      return;
    }

    await delay(DRAIN_WINDOW_MS);
  }

  /**
   * The slot holds the **raw** promise and is only released when it settles —
   * never when a caller's deadline expires. Releasing on the deadline would make
   * every following check fire a new query on top of the still pending ones,
   * and the health check would become a cause of unavailability.
   */
  private runExclusively(): Promise<HealthCheckResult> {
    if (this.pending) {
      return this.pending;
    }

    const pending = this.check.run();

    this.pending = pending;

    // The `catch` exists because `finally` returns a **new** promise, which
    // rejects along with the original: without it, a rejecting check would
    // produce an unhandled rejection on top of the error the caller already gets.
    //
    // The cleanup is unconditional on purpose. `runExclusively` is the only
    // writer of the slot and only fills it when empty, so the promise settling
    // here is necessarily the stored one: an identity check would never be false
    // and would silently absorb a future second writer instead of letting it
    // fail loudly.
    void pending
      .finally(() => {
        this.pending = undefined;
      })
      .catch(() => undefined);

    return pending;
  }

  private recordTransition(result: HealthCheckResult): void {
    if (!result.healthy) {
      if (this.degradedSince !== undefined) {
        return;
      }

      this.degradedSince = Date.now();

      this.logger.event(TECHNICAL_EVENTS.HEALTH_DEGRADED, {
        dependencyName: POSTGRES_DEPENDENCY_NAME,
        healthFailureCategory: result.category,
      });

      return;
    }

    if (this.degradedSince === undefined) {
      return;
    }

    const healthDegradedDurationMs = Date.now() - this.degradedSince;

    this.degradedSince = undefined;

    this.logger.event(TECHNICAL_EVENTS.HEALTH_RECOVERED, {
      dependencyName: POSTGRES_DEPENDENCY_NAME,
      healthDegradedDurationMs,
    });
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
