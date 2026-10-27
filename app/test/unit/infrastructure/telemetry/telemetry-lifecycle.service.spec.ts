import { TelemetryLifecycleService } from '@infrastructure/telemetry/telemetry-lifecycle.service';
import { registerTelemetrySdk } from '@infrastructure/telemetry/telemetry-sdk.registry';
import { captureDiagnostics, DiagnosticsCapture } from '../../../helpers/diagnostics-capture';

describe('TelemetryLifecycleService', () => {
  let service: TelemetryLifecycleService;
  let diagnostics: DiagnosticsCapture;

  beforeEach(() => {
    service = new TelemetryLifecycleService();
    diagnostics = captureDiagnostics();
  });

  afterEach(() => {
    diagnostics.restore();
    registerTelemetrySdk(undefined);
  });

  /**
   * The regression this test prevents is exactly the one that happened with
   * Prisma's `$disconnect()`, and it is **silent**: Nest runs
   * `callDestroyHook -> callBeforeShutdownHook -> dispose -> callShutdownHook`,
   * so flushing in `onModuleDestroy` would export the spans of requests still in
   * flight. No behavior test would catch it — both ways "work".
   */
  it('should flush on onApplicationShutdown, not on onModuleDestroy', () => {
    expect(typeof service.onApplicationShutdown).toBe('function');
    expect((service as unknown as Record<string, unknown>).onModuleDestroy).toBeUndefined();
    expect(
      (service as unknown as Record<string, unknown>).beforeApplicationShutdown,
    ).toBeUndefined();
  });

  it('should call shutdown on the instance registered by the preload', async () => {
    const shutdown = jest.fn().mockResolvedValue(undefined);
    registerTelemetrySdk({ shutdown });

    await service.onApplicationShutdown();

    expect(shutdown).toHaveBeenCalledTimes(1);
  });

  it('should do nothing when telemetry is disabled', async () => {
    await expect(service.onApplicationShutdown()).resolves.toBeUndefined();
    expect(diagnostics.text()).toBe('');
  });

  it('should absorb a flush failure and report it on the error channel', async () => {
    registerTelemetrySdk({ shutdown: jest.fn().mockRejectedValue(new Error('export failed')) });

    await expect(service.onApplicationShutdown()).resolves.toBeUndefined();

    const [line] = diagnostics.lines();
    expect(line['oficina.telemetry.failure.stage']).toBe('shutdown');
    expect(line.message).toBe('telemetry failure');
  });

  /**
   * A destination that accepts the connection and never answers must not eat the
   * whole shutdown window: `SIGKILL` would cut the following hooks along with it.
   */
  it('should give up waiting when the flush never completes', async () => {
    jest.useFakeTimers();
    registerTelemetrySdk({ shutdown: () => new Promise<void>(() => undefined) });

    const pending = service.onApplicationShutdown();
    jest.runOnlyPendingTimers();

    await expect(pending).resolves.toBeUndefined();
    jest.useRealTimers();
  });
});
