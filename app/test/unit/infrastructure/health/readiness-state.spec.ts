import {
  HEALTH_CHECK_DEADLINE_MS,
  HealthCheckResult,
  POSTGRES_DEPENDENCY_NAME,
} from '@infrastructure/health/postgres.health-check';
import {
  DRAIN_WINDOW_MS,
  isDrainWindowEnabled,
  ReadinessState,
} from '@infrastructure/health/readiness-state';
import { TECHNICAL_EVENTS } from '@infrastructure/logging/technical-event.catalog';

import {
  createMockPostgresHealthCheck,
  MockPostgresHealthCheck,
} from '../../../helpers/health-mock.factory';
import { createMockLogger } from '../../../helpers/logger-mock.factory';

const HEALTHY: HealthCheckResult = { healthy: true };
const UNREACHABLE: HealthCheckResult = { healthy: false, category: 'connection' };

function hangingPromise(): Promise<HealthCheckResult> {
  return new Promise<HealthCheckResult>(() => undefined);
}

describe('ReadinessState — exclusivity of verification', () => {
  let check: MockPostgresHealthCheck;
  let state: ReadinessState;

  beforeEach(() => {
    check = createMockPostgresHealthCheck();
    state = new ReadinessState(check, createMockLogger());
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should serve a concurrent burst from a single query', async () => {
    let settle!: (result: HealthCheckResult) => void;

    check.run.mockReturnValue(
      new Promise<HealthCheckResult>((resolve) => {
        settle = resolve;
      }),
    );

    const callers = [state.isReady(), state.isReady(), state.isReady()];

    settle(HEALTHY);

    await expect(Promise.all(callers)).resolves.toEqual([true, true, true]);
    expect(check.run).toHaveBeenCalledTimes(1);
  });

  it('should run a new query for a caller arriving after the previous one settled', async () => {
    check.run.mockResolvedValue(HEALTHY);

    await state.isReady();
    await state.isReady();

    expect(check.run).toHaveBeenCalledTimes(2);
  });

  /**
   * The test that proves the **raw promise** slot: the deadline is per caller and
   * only abandons the wait, so releasing the slot on it would make every
   * following check fire a new query on top of the still pending ones — the
   * pileup that turns the health check into a cause of unavailability.
   */
  it('should answer unavailable within its own deadline without starting a new query', async () => {
    jest.useFakeTimers();

    check.run.mockReturnValue(hangingPromise());

    const first = state.isReady();

    await jest.advanceTimersByTimeAsync(HEALTH_CHECK_DEADLINE_MS);

    await expect(first).resolves.toBe(false);

    const second = state.isReady();

    await jest.advanceTimersByTimeAsync(HEALTH_CHECK_DEADLINE_MS);

    await expect(second).resolves.toBe(false);
    expect(check.run).toHaveBeenCalledTimes(1);
  });

  /**
   * The boundary is by **origin**: what the query rejects becomes unavailability
   * inside `PostgresHealthCheck`, but a defect in the check path propagates —
   * the controller does not turn it into `503` and it goes out as `500` through
   * the global handling. The slot must be released all the same: holding it
   * would leave the replica stuck on a rejected promise, never checking again.
   */
  it('should release the slot and propagate when the verification itself defects', async () => {
    const defect = new TypeError('estado corrompido');

    check.run.mockRejectedValueOnce(defect).mockResolvedValueOnce(HEALTHY);

    await expect(state.isReady()).rejects.toThrow(defect);
    await expect(state.isReady()).resolves.toBe(true);

    expect(check.run).toHaveBeenCalledTimes(2);
  });

  it('should not derive readiness from an already concluded result', async () => {
    check.run.mockResolvedValueOnce(UNREACHABLE).mockResolvedValueOnce(HEALTHY);

    await expect(state.isReady()).resolves.toBe(false);
    await expect(state.isReady()).resolves.toBe(true);
  });
});

describe('ReadinessState — transition detection', () => {
  let check: MockPostgresHealthCheck;
  let logger: ReturnType<typeof createMockLogger>;
  let state: ReadinessState;

  beforeEach(() => {
    check = createMockPostgresHealthCheck();
    logger = createMockLogger();
    state = new ReadinessState(check, logger);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should scope the logger to itself', () => {
    expect(logger.forContext).toHaveBeenCalledWith('ReadinessState');
  });

  it('should emit degradation once, carrying the cause category', async () => {
    check.run.mockResolvedValue(UNREACHABLE);

    await state.isReady();
    await state.isReady();
    await state.isReady();

    expect(logger.event).toHaveBeenCalledTimes(1);
    expect(logger.event).toHaveBeenCalledWith(TECHNICAL_EVENTS.HEALTH_DEGRADED, {
      dependencyName: POSTGRES_DEPENDENCY_NAME,
      healthFailureCategory: 'connection',
    });
  });

  it('should distinguish causes that produce identical HTTP responses', async () => {
    check.run.mockResolvedValue({ healthy: false, category: 'pool' });

    await state.isReady();

    expect(logger.event).toHaveBeenCalledWith(TECHNICAL_EVENTS.HEALTH_DEGRADED, {
      dependencyName: POSTGRES_DEPENDENCY_NAME,
      healthFailureCategory: 'pool',
    });
  });

  it('should emit recovery carrying how long the degradation lasted', async () => {
    jest.useFakeTimers();

    check.run.mockResolvedValueOnce(UNREACHABLE).mockResolvedValue(HEALTHY);

    await state.isReady();

    jest.setSystemTime(Date.now() + 42_000);

    await expect(state.isReady()).resolves.toBe(true);

    expect(logger.event).toHaveBeenLastCalledWith(TECHNICAL_EVENTS.HEALTH_RECOVERED, {
      dependencyName: POSTGRES_DEPENDENCY_NAME,
      healthDegradedDurationMs: 42_000,
    });
  });

  it('should not emit anything while the dependency stays healthy', async () => {
    check.run.mockResolvedValue(HEALTHY);

    await state.isReady();
    await state.isReady();

    expect(logger.event).not.toHaveBeenCalled();
  });

  it('should emit degradation when the very first check already fails', async () => {
    check.run.mockResolvedValue({ healthy: false, category: 'timeout' });

    await state.isReady();

    expect(logger.event).toHaveBeenCalledTimes(1);
    expect(logger.event).toHaveBeenCalledWith(TECHNICAL_EVENTS.HEALTH_DEGRADED, {
      dependencyName: POSTGRES_DEPENDENCY_NAME,
      healthFailureCategory: 'timeout',
    });
  });

  /**
   * A check started before the termination signal and finished after it must
   * not restore `ready` nor emit a recovery: the shutdown state is checked
   * **before** any result is applied.
   */
  it('should not let a result settling after the termination signal restore readiness', async () => {
    jest.useFakeTimers();

    let settle!: (result: HealthCheckResult) => void;

    check.run.mockResolvedValueOnce(UNREACHABLE).mockReturnValueOnce(
      new Promise<HealthCheckResult>((resolve) => {
        settle = resolve;
      }),
    );

    await state.isReady();

    logger.event.mockClear();

    const inFlight = state.isReady();

    void state.beforeApplicationShutdown('SIGTERM');

    settle(HEALTHY);

    await expect(inFlight).resolves.toBe(false);
    expect(logger.event).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(DRAIN_WINDOW_MS);
  });
});

describe('ReadinessState — closing window', () => {
  let check: MockPostgresHealthCheck;
  let state: ReadinessState;
  let previousEnvironment: string | undefined;

  beforeEach(() => {
    jest.useFakeTimers();

    previousEnvironment = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    check = createMockPostgresHealthCheck();
    check.run.mockResolvedValue(HEALTHY);
    state = new ReadinessState(check, createMockLogger());
  });

  afterEach(() => {
    process.env.NODE_ENV = previousEnvironment;

    jest.useRealTimers();
  });

  it('should mark draining before waiting and hold it for the whole window', async () => {
    let settled = false;

    void state.beforeApplicationShutdown('SIGTERM').then(() => {
      settled = true;
    });

    await jest.advanceTimersByTimeAsync(0);

    expect(settled).toBe(false);
    await expect(state.isReady()).resolves.toBe(false);

    await jest.advanceTimersByTimeAsync(DRAIN_WINDOW_MS - 1);

    expect(settled).toBe(false);
    await expect(state.isReady()).resolves.toBe(false);

    await jest.advanceTimersByTimeAsync(1);

    expect(settled).toBe(true);
  });

  it('should never consult the dependency once draining', async () => {
    void state.beforeApplicationShutdown('SIGTERM');

    await expect(state.isReady()).resolves.toBe(false);

    expect(check.run).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(DRAIN_WINDOW_MS);
  });

  /**
   * Without this condition, every E2E suite — which ends with `app.close()` and
   * no signal — would hold the Jest worker for the whole window; and `main.ts`'s
   * bootstrap-failure path would keep the event loop alive through the timer
   * itself, making the 5 s watchdog cut short the shutdown the window should
   * order.
   */
  it('should not wait at all when the shutdown carries no termination signal', async () => {
    let settled = false;

    void state.beforeApplicationShutdown().then(() => {
      settled = true;
    });

    await jest.advanceTimersByTimeAsync(0);

    expect(settled).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('should still mark draining on a programmatic shutdown', async () => {
    await state.beforeApplicationShutdown();

    await expect(state.isReady()).resolves.toBe(false);
    expect(check.run).not.toHaveBeenCalled();
  });

  it('should not wait for a signal that is not a termination signal', async () => {
    let settled = false;

    void state.beforeApplicationShutdown('SIGUSR2').then(() => {
      settled = true;
    });

    await jest.advanceTimersByTimeAsync(0);

    expect(settled).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
  });

  /**
   * `nest start --watch` kills the process with `SIGTERM` and only respawns on
   * `exit`, so without this condition every hot reload on Linux/macOS would pay
   * the whole window — and there is no data plane to propagate the removal to.
   */
  it('should still mark draining outside an orchestrated environment, but not wait', async () => {
    process.env.NODE_ENV = 'development';

    let settled = false;

    void state.beforeApplicationShutdown('SIGTERM').then(() => {
      settled = true;
    });

    await jest.advanceTimersByTimeAsync(0);

    expect(settled).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
    await expect(state.isReady()).resolves.toBe(false);
  });
});

describe('isDrainWindowEnabled', () => {
  it.each([
    ['production', true],
    ['development', false],
    ['test', false],
    [undefined, false],
  ])('should resolve %s to %s', (environment, expected) => {
    expect(isDrainWindowEnabled({ NODE_ENV: environment })).toBe(expected);
  });
});
