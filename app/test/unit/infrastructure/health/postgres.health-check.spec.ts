import {
  HEALTH_CHECK_DEADLINE_MS,
  HEALTH_QUERY_TIMEOUT_MS,
  HealthCheckResult,
  PostgresHealthCheck,
  withDeadline,
} from '@infrastructure/health/postgres.health-check';
import { HealthFailureCategory } from '@infrastructure/logging/technical-event.catalog';

import { createMockPrismaClient, MockPrismaService } from '../../../helpers/prisma-mock.factory';

function withCode(message: string, code: string, extra: Record<string, unknown> = {}): Error {
  return Object.assign(new Error(message), { code, ...extra });
}

/**
 * The shape `pg` delivers for a server error: SQLSTATE in `code`, plus
 * `severity` and `routine`. The check talks to the driver directly, so this is
 * the shape that arrives — without Prisma's `P2010` wrapper.
 */
function serverError(code: string, message = 'erro do servidor'): Error {
  return Object.assign(new Error(message), { code, severity: 'FATAL', routine: 'auth_failed' });
}

describe('PostgresHealthCheck', () => {
  let prisma: MockPrismaService;
  let check: PostgresHealthCheck;

  beforeEach(() => {
    prisma = createMockPrismaClient();
    check = new PostgresHealthCheck(prisma);
  });

  it('should report health when the trivial query resolves', async () => {
    prisma.pool.query.mockResolvedValue({ rows: [{ '?column?': 1 }] });

    await expect(check.run()).resolves.toEqual({ healthy: true });
    expect(prisma.pool.query).toHaveBeenCalledTimes(1);
  });

  /**
   * The only deadline that **ends** the operation: `pg` rejects the promise, the
   * pool removes the client and the socket is destroyed. It is what frees the
   * single `ReadinessState` slot. Applied per query, no business route inherits
   * a cap.
   */
  it('should bound the verification query itself, not only the caller wait', async () => {
    prisma.pool.query.mockResolvedValue({ rows: [] });

    await check.run();

    expect(prisma.pool.query).toHaveBeenCalledWith({
      text: 'SELECT 1',
      query_timeout: HEALTH_QUERY_TIMEOUT_MS,
    });
  });

  /**
   * The category derives from the failure's **shape** — a SQLSTATE or a `libuv`
   * code. The only pair compared by message is the exact equality against the
   * `pg` constants, which arrive without a `code`.
   */
  it.each<[string, unknown, HealthFailureCategory]>([
    ['a refused socket', withCode('connect ECONNREFUSED', 'ECONNREFUSED'), 'connection'],
    ['an unresolved host', withCode('getaddrinfo ENOTFOUND', 'ENOTFOUND'), 'connection'],
    ['a socket timeout', withCode('connect ETIMEDOUT', 'ETIMEDOUT'), 'timeout'],
    ['a reset connection', withCode('read ECONNRESET', 'ECONNRESET'), 'connection'],
    ['an invalid password', serverError('28P01'), 'authentication'],
    ['a denied database access', serverError('42501'), 'authentication'],
    ['a server-side connection limit', serverError('53300'), 'pool'],
    ['an exhausted configuration limit', serverError('53400'), 'pool'],
    ['a missing database', serverError('3D000'), 'connection'],
    ['an admin shutdown', serverError('57P01'), 'connection'],
    ['a syntax error', serverError('42601'), 'query'],
    ['a missing relation', serverError('42P01'), 'query'],
    ['a cancelled statement', serverError('57014'), 'timeout'],
    ['a broken connection', serverError('08006'), 'connection'],
    ['a pool acquisition timeout', new Error('timeout exceeded when trying to connect'), 'pool'],
    [
      'a connection establishment timeout',
      new Error('Connection terminated due to connection timeout'),
      'connection',
    ],
    ['a socket that died mid-query', new Error('Connection terminated unexpectedly'), 'connection'],
    ['a terminated connection', new Error('Connection terminated'), 'connection'],
    [
      'a client poisoned by a connection error',
      new Error('Client has encountered a connection error and is not queryable'),
      'connection',
    ],
    [
      'a client closed under the query',
      new Error('Client was closed and is not queryable'),
      'connection',
    ],
    [
      'a pool already ended',
      new Error('Cannot use a pool after calling end on the pool'),
      'connection',
    ],
    // The message `query_timeout` itself produces (`pg/lib/client.js`).
    ['an expired per-query deadline', new Error('Query read timeout'), 'timeout'],
    ['an expired query timer', new Error('timeout expired'), 'timeout'],
    [
      'a driver code reached through the cause chain',
      Object.assign(new Error('outer'), { cause: withCode('inner', 'ECONNREFUSED') }),
      'connection',
    ],
    // `localhost` resolves to ::1 and 127.0.0.1, and Node's `net.connect`
    // aggregates the attempts per address family. Without visiting the aggregates
    // this would come out `unknown` — which is how the E2E behaved before the
    // chain covered `errors`.
    [
      'an aggregate of per-family connection attempts',
      Object.assign(new Error('connect ECONNREFUSED ::1:5432'), {
        errors: [withCode('connect ECONNREFUSED ::1:5432', 'ECONNREFUSED')],
      }),
      'connection',
    ],
  ])('should map %s to its category', async (_name, failure, category) => {
    prisma.pool.query.mockRejectedValue(failure);

    await expect(check.run()).resolves.toEqual({ healthy: false, category });
  });

  it.each<[string, unknown]>([
    ['an unrecognized failure', new Error('algo que ninguém previu')],
    ['an unmapped SQLSTATE', serverError('22012', 'division by zero')],
    ['a rejection whose fields are not text', { code: 42, message: 500 }],
  ])(
    'should fall back to the unknown category for %s instead of omitting the result',
    async (_name, failure) => {
      prisma.pool.query.mockRejectedValue(failure);

      await expect(check.run()).resolves.toEqual({ healthy: false, category: 'unknown' });
    },
  );

  it('should not treat a non-error rejection as a defect', async () => {
    prisma.pool.query.mockRejectedValue('falha em texto puro');

    await expect(check.run()).resolves.toEqual({ healthy: false, category: 'unknown' });
  });

  it('should not walk a cause chain forever', async () => {
    const cyclic: { message: string; cause?: unknown } = { message: 'loop' };
    cyclic.cause = cyclic;

    prisma.pool.query.mockRejectedValue(cyclic);

    await expect(check.run()).resolves.toEqual({ healthy: false, category: 'unknown' });
  });

  /**
   * On a public route the driver message names host and port. The result
   * carries **only** the category, and it is what feeds the `503` body.
   */
  it('should never carry driver-originated text in the result', async () => {
    prisma.pool.query.mockRejectedValue(
      withCode('connect ECONNREFUSED db.internal:5432', 'ECONNREFUSED'),
    );

    const result = await check.run();

    expect(result).toEqual({ healthy: false, category: 'connection' });
    expect(JSON.stringify(result)).not.toContain('db.internal');
    expect(JSON.stringify(result)).not.toContain('5432');
  });
});

describe('withDeadline', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  /**
   * Longer than the pool's `connectionTimeoutMillis` (3 s): a shorter deadline
   * would answer before the acquisition failure shows up and classify it as
   * `timeout`, erasing the `pool` category.
   */
  it('should outlast the pool acquisition timeout', () => {
    expect(HEALTH_CHECK_DEADLINE_MS).toBeGreaterThan(3_000);
  });

  it('should answer unavailability when the operation does not settle in time', async () => {
    jest.useFakeTimers();

    const hanging = withDeadline(new Promise<HealthCheckResult>(() => undefined));

    await jest.advanceTimersByTimeAsync(HEALTH_CHECK_DEADLINE_MS);

    await expect(hanging).resolves.toEqual({ healthy: false, category: 'timeout' });
  });

  it('should keep the result of an operation that settles first', async () => {
    jest.useFakeTimers();

    const settled = withDeadline(Promise.resolve<HealthCheckResult>({ healthy: true }));

    await expect(settled).resolves.toEqual({ healthy: true });
    expect(jest.getTimerCount()).toBe(0);
  });

  it('should clear its timer once the deadline fires', async () => {
    jest.useFakeTimers();

    const hanging = withDeadline(new Promise<HealthCheckResult>(() => undefined));

    await jest.advanceTimersByTimeAsync(HEALTH_CHECK_DEADLINE_MS);
    await hanging;

    expect(jest.getTimerCount()).toBe(0);
  });
});
