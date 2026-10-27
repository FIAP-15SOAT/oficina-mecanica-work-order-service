import { resolveLoggerConfig } from '@infrastructure/logging/logger.config';
import { buildTelemetryResource } from '@infrastructure/telemetry/telemetry-resource';

const SHARED_ATTRIBUTES = [
  'service.name',
  'service.namespace',
  'service.version',
  'service.instance.id',
  'deployment.environment.name',
] as const;

describe('buildTelemetryResource', () => {
  /**
   * The divergence this test prevents is silent: a different
   * `service`/`env`/`version` across signals breaks nothing — the data shows up
   * at the destination and simply does not join the other signals.
   */
  it('should declare exactly the same five attributes as the log line', () => {
    const resource = buildTelemetryResource();
    const { resource: logResource } = resolveLoggerConfig();

    for (const attribute of SHARED_ATTRIBUTES) {
      expect(resource.attributes[attribute]).toBe(logResource[attribute]);
    }
  });

  /**
   * The previous assertion was "exactly these five attributes", and it was what
   * locked the defect in: `NodeSDK` resolves `configuration.resource ??
   * defaultResource()`, so handing over our own resource dropped the SDK
   * identity. Forbidding any extra key turned the fix into a test failure.
   */
  it('should carry the SDK identity the specification requires', () => {
    const { attributes } = buildTelemetryResource();

    expect(attributes['telemetry.sdk.name']).toBe('opentelemetry');
    expect(attributes['telemetry.sdk.language']).toBe('nodejs');
    expect(typeof attributes['telemetry.sdk.version']).toBe('string');
  });

  /**
   * `defaultResource()` brings `service.name: 'unknown_service:node'`. The merge
   * must let the five shared ones win — inverted, the service goes out anonymous
   * and nothing correlates.
   */
  it('should let the shared attributes win over the SDK defaults', () => {
    expect(buildTelemetryResource().attributes['service.name']).toBe(
      resolveLoggerConfig().resource['service.name'],
    );
    expect(buildTelemetryResource().attributes['service.name']).not.toBe('unknown_service:node');
  });

  /**
   * `service.instance.id` is a module-level `randomUUID()`: the require cache is
   * what guarantees the same value on every emission of the process.
   */
  it('should keep service.instance.id stable within the process', () => {
    expect(buildTelemetryResource().attributes['service.instance.id']).toBe(
      buildTelemetryResource().attributes['service.instance.id'],
    );
  });

  it('should use the declared fallback when the version does not come from the environment', () => {
    const resource = buildTelemetryResource();

    expect(typeof resource.attributes['service.version']).toBe('string');
    expect(resource.attributes['service.version']).not.toBe('');
  });
});
