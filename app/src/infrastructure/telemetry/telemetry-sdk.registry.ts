export interface TelemetrySdk {
  shutdown(): Promise<void>;
}

let registered: TelemetrySdk | undefined;

/**
 * Bridge between the preload and the injection container: `src/otel.ts` is
 * loaded by `--require`, long before Nest exists, and registers here the
 * instance it created. The shutdown hook gets it back through the require
 * cache, without importing the preload — which, if imported, would drag the
 * whole SDK into every process, including the E2E suites, where telemetry is
 * off and none of it needs to load.
 */
export function registerTelemetrySdk(sdk: TelemetrySdk | undefined): void {
  registered = sdk;
}

export function getTelemetrySdk(): TelemetrySdk | undefined {
  return registered;
}
