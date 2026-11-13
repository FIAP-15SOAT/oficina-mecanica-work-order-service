import { AggregationType } from '@opentelemetry/sdk-metrics';

import { BusinessMetricDefinition, BusinessMetricName } from '@application/metrics/business-metric';
import { BUSINESS_METRICS } from '@application/metrics/business-metric.catalog';
import { MetricAttributeName, MetricAttributes } from '@application/metrics/metric-attribute';
import {
  METRIC_ATTRIBUTE_REGISTRY,
  METRIC_REGISTRY,
  MetricCardinality,
  resolveMetricAttribute,
  resolveMetricKey,
} from '@infrastructure/telemetry/metric-registry';

type AttributesOf<TDefinition> =
  TDefinition extends BusinessMetricDefinition<infer TAttributes> ? keyof TAttributes : never;

type CatalogAttributeName = AttributesOf<(typeof BUSINESS_METRICS)[keyof typeof BUSINESS_METRICS]>;

type CatalogMetricName = (typeof BUSINESS_METRICS)[keyof typeof BUSINESS_METRICS]['name'];

type Assert<T extends true> = T;

type MutuallyAssignable<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

/**
 * Compilation fails in both directions: a metric declared in the vocabulary
 * that no catalog entry emits (a dead entry), or a catalog metric with no
 * registry entry (a physical name missing at runtime). The registry's
 * `Record<BusinessMetricName, ...>` closes the second direction; this
 * assertion closes the first.
 */
type _CatalogMatchesVocabulary = Assert<MutuallyAssignable<CatalogMetricName, BusinessMetricName>>;

/**
 * Every attribute the catalog declares must exist in the logical vocabulary —
 * otherwise the adapter would drop it at runtime, and the metric would go out
 * without the dimension the dashboard expects.
 */
type _AttributesBelongToVocabulary = Assert<
  [CatalogAttributeName] extends [MetricAttributeName] ? true : false
>;

/**
 * `high` is not part of the type: declaring high cardinality on a metric
 * attribute is a **compile error**, not a forgotten review. It is what keeps a
 * work order, customer or user identifier from becoming a dimension and
 * multiplying series without limit.
 */
type _NoHighCardinalityAttribute = Assert<'high' extends MetricCardinality ? false : true>;

describe('metric registry', () => {
  it('should declare a physical name for every metric in the catalog', () => {
    for (const definition of Object.values(BUSINESS_METRICS)) {
      expect(resolveMetricKey(definition.name)).toBeDefined();
    }
  });

  it('should keep physical names inside the application owned namespace', () => {
    for (const entry of Object.values(METRIC_REGISTRY)) {
      expect(entry.key.startsWith('oficina.')).toBe(true);
    }
  });

  /**
   * The convention does not define this attribute, and extending one of its
   * namespaces is forbidden: `oficina.work_order.status`, never `work_order.status`.
   */
  it('should keep attribute names inside the owned namespace', () => {
    for (const entry of Object.values(METRIC_ATTRIBUTE_REGISTRY)) {
      expect(entry.key.startsWith('oficina.')).toBe(true);
    }
  });

  it('should declare exponential aggregation for every business duration', () => {
    const durations = Object.values(BUSINESS_METRICS).filter(
      (definition) => definition.unit === 's',
    );

    expect(durations).toHaveLength(4);

    for (const definition of durations) {
      expect(METRIC_REGISTRY[definition.name].aggregation.type).toBe(
        AggregationType.EXPONENTIAL_HISTOGRAM,
      );
    }
  });

  it.each([
    BUSINESS_METRICS.WORK_ORDER_CREATED,
    BUSINESS_METRICS.SAGA_STARTED,
    BUSINESS_METRICS.SAGA_FINISHED,
  ])('should not declare a custom aggregation for the counter $name', (definition) => {
    expect(METRIC_REGISTRY[definition.name].aggregation.type).toBe(AggregationType.DEFAULT);
  });

  it('should map the saga metrics and attributes to the owned saga namespace', () => {
    expect(resolveMetricKey(BUSINESS_METRICS.SAGA_STARTED.name)).toBe('oficina.saga.started');
    expect(resolveMetricKey(BUSINESS_METRICS.SAGA_FINISHED.name)).toBe('oficina.saga.finished');
    expect(resolveMetricKey(BUSINESS_METRICS.SAGA_DURATION.name)).toBe('oficina.saga.duration');
    expect(resolveMetricAttribute('sagaType')).toEqual({
      key: 'oficina.saga.type',
      cardinality: 'fixed',
    });
    expect(resolveMetricAttribute('sagaOutcome')).toEqual({
      key: 'oficina.saga.outcome',
      cardinality: 'fixed',
    });
  });

  /**
   * An entity identifier as an attribute multiplies time series without limit,
   * at a cost proportional to traffic.
   */
  it('should not declare any entity identifier as an attribute', () => {
    const forbidden = ['id', 'customer', 'user', 'vehicle', 'number'];

    for (const name of Object.keys(METRIC_ATTRIBUTE_REGISTRY) as MetricAttributeName[]) {
      for (const token of forbidden) {
        expect(name.toLowerCase()).not.toContain(token);
      }
    }
  });

  it('should return undefined for an attribute outside the logical vocabulary', () => {
    expect(resolveMetricAttribute('workOrderId')).toBeUndefined();
    expect(resolveMetricAttribute('workOrderStatus')).toBeDefined();
  });

  it('should keep the catalog attribute type compatible with the vocabulary', () => {
    const attributes: MetricAttributes = { workOrderStatus: 'APPROVED' };

    expect(Object.keys(attributes)).toEqual(['workOrderStatus']);
  });
});
