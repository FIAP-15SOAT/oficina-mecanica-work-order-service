import { Injectable } from '@nestjs/common';
import type { QueryConfig } from 'pg';

import { HealthFailureCategory } from '@infrastructure/logging/technical-event.catalog';
import { PrismaService } from '@infrastructure/persistence/prisma/prisma.service';

export const POSTGRES_DEPENDENCY_NAME = 'postgresql';

/**
 * The only deadline that **ends** the operation instead of abandoning it: `pg`
 * rejects the promise, the `Pool` removes the client and `Client.end()` destroys
 * the socket because a query is active. That is what frees the single
 * `ReadinessState` slot and lets the replica become ready again without a
 * restart. Applied **per query**, so no business route inherits a duration cap.
 */
export const HEALTH_QUERY_TIMEOUT_MS = 2_000;

/**
 * Per-caller deadline, deliberately **longer** than the pool's
 * `connectionTimeoutMillis` (3 s): an acquisition failure only shows up when
 * that deadline expires, and a shorter one would mask it as `timeout`, erasing
 * exactly the `pool` category. Shorter than the readinessProbe `timeoutSeconds`
 * (5 s) plus network margin, so the deadline that answers is ours and not the
 * kubelet's — aborting on the orchestrator side produces `client_aborted` and
 * no cause category.
 */
export const HEALTH_CHECK_DEADLINE_MS = 3_500;

export type HealthCheckResult =
  | { readonly healthy: true }
  | { readonly healthy: false; readonly category: HealthFailureCategory };

const HEALTHY: HealthCheckResult = { healthy: true };

const TIMED_OUT: HealthCheckResult = { healthy: false, category: 'timeout' };

const MAX_CAUSE_DEPTH = 5;

/**
 * PostgreSQL SQLSTATE and `libuv` codes. The check talks to `pg` directly, so
 * what arrives here is the driver error, unwrapped.
 */
const CATEGORY_BY_CODE: ReadonlyMap<string, HealthFailureCategory> = new Map<
  string,
  HealthFailureCategory
>([
  ['ECONNREFUSED', 'connection'],
  ['ECONNRESET', 'connection'],
  ['EHOSTUNREACH', 'connection'],
  ['ENETUNREACH', 'connection'],
  ['ENOTFOUND', 'connection'],
  ['EAI_AGAIN', 'connection'],
  ['EPIPE', 'connection'],
  ['ETIMEDOUT', 'timeout'],
  ['08000', 'connection'],
  ['08001', 'connection'],
  ['08003', 'connection'],
  ['08004', 'connection'],
  ['08006', 'connection'],
  ['08P01', 'connection'],
  ['28000', 'authentication'],
  ['28P01', 'authentication'],
  ['3D000', 'connection'],
  ['42501', 'authentication'],
  ['42601', 'query'],
  ['42883', 'query'],
  ['42P01', 'query'],
  ['53300', 'pool'],
  ['53400', 'pool'],
  ['57014', 'timeout'],
  ['57P01', 'connection'],
  ['57P03', 'connection'],
]);

/**
 * The failures `pg` delivers **without** a `code`: constant-message `Error`s,
 * enumerated from the installed source. The comparison is by **exact equality**,
 * never by substring — the anti-pattern that makes a reworded message classify
 * wrongly in silence.
 */
const CATEGORY_BY_MESSAGE: ReadonlyMap<string, HealthFailureCategory> = new Map<
  string,
  HealthFailureCategory
>([
  ['timeout exceeded when trying to connect', 'pool'],
  ['Connection terminated due to connection timeout', 'connection'],
  ['Connection terminated unexpectedly', 'connection'],
  ['Connection terminated', 'connection'],
  ['Client has encountered a connection error and is not queryable', 'connection'],
  ['Client was closed and is not queryable', 'connection'],
  ['Cannot use a pool after calling end on the pool', 'connection'],
  ['Called end on pool more than once', 'connection'],
  ['Query read timeout', 'timeout'],
  ['timeout expired', 'timeout'],
]);

interface ErrorShape {
  code?: unknown;
  message?: unknown;
  cause?: unknown;
  errors?: unknown;
}

/**
 * Walks `cause` and `errors` beyond the root error: Node's `net.connect`
 * aggregates the attempts per address family into an `AggregateError`, and
 * `localhost` resolves to two. Without visiting the aggregates, an
 * `ECONNREFUSED` would come out as `unknown`.
 */
export function classifyHealthFailure(error: unknown): HealthFailureCategory {
  const pending: unknown[] = [error];

  for (let visited = 0; visited <= MAX_CAUSE_DEPTH && pending.length > 0; visited += 1) {
    const current = pending.shift();

    if (current === null || typeof current !== 'object') {
      continue;
    }

    const shape = current as ErrorShape;
    const category = matchCode(shape.code) ?? matchMessage(shape.message);

    if (category) {
      return category;
    }

    if (shape.cause !== undefined) {
      pending.push(shape.cause);
    }

    if (Array.isArray(shape.errors)) {
      pending.push(...(shape.errors as unknown[]).slice(0, MAX_CAUSE_DEPTH));
    }
  }

  return 'unknown';
}

function matchCode(code: unknown): HealthFailureCategory | undefined {
  return typeof code === 'string' ? CATEGORY_BY_CODE.get(code) : undefined;
}

function matchMessage(message: unknown): HealthFailureCategory | undefined {
  return typeof message === 'string' ? CATEGORY_BY_MESSAGE.get(message) : undefined;
}

/**
 * Abandons the caller's wait; what **ends** the operation is the
 * `query_timeout` above. That is why the promise received here stays alive
 * after the `race`, and the `ReadinessState` slot keeps holding it until it
 * settles.
 */
export function withDeadline(
  pending: Promise<HealthCheckResult>,
  deadlineMs: number = HEALTH_CHECK_DEADLINE_MS,
): Promise<HealthCheckResult> {
  let timer: NodeJS.Timeout | undefined;

  const deadline = new Promise<HealthCheckResult>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), deadlineMs);
    timer.unref?.();
  });

  return Promise.race([pending, deadline]).finally(() => clearTimeout(timer));
}

@Injectable()
export class PostgresHealthCheck {
  constructor(private readonly prisma: PrismaService) {}

  async run(): Promise<HealthCheckResult> {
    const verification: QueryConfig & { query_timeout: number } = {
      text: 'SELECT 1',
      query_timeout: HEALTH_QUERY_TIMEOUT_MS,
    };

    try {
      await this.prisma.pool.query(verification);
    } catch (error) {
      return { healthy: false, category: classifyHealthFailure(error) };
    }

    return HEALTHY;
  }
}
