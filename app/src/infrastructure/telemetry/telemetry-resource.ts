import { defaultResource, resourceFromAttributes } from '@opentelemetry/resources';
import type { Resource } from '@opentelemetry/resources';

import { resolveLoggerConfig } from '@infrastructure/logging/logger.config';

/**
 * Single source of the resource attributes: the five that identify the service
 * — name, namespace, version, instance and environment — come from the **same**
 * resolution the log uses, so they are identical across log, trace and metric
 * by construction, not by convention.
 *
 * ⚠️ `defaultResource()` is the base, not a detail: `NodeSDK` resolves the
 * resource as `configuration.resource ?? defaultResource()`, so **passing our
 * own resource drops the whole default** — and with it `telemetry.sdk.name`,
 * `telemetry.sdk.language` and `telemetry.sdk.version`, which the specification
 * requires and which identify the SDK that produced the data. Measured: without
 * this merge the three go out in neither span nor metric.
 *
 * Order matters. `merge()` makes the **argument win** the collision, so the
 * five shared ones overwrite the `service.name: 'unknown_service:node'` the
 * default brings. Swapping the sides would bring back the anonymous service.
 */
export function buildTelemetryResource(): Resource {
  return defaultResource().merge(resourceFromAttributes({ ...resolveLoggerConfig().resource }));
}
