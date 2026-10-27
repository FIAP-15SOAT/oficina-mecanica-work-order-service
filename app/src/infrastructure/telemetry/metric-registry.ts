import { AggregationOption, AggregationType, ViewOptions } from '@opentelemetry/sdk-metrics';

import { BusinessMetricName } from '@application/metrics/business-metric';
import { MetricAttributeName } from '@application/metrics/metric-attribute';

export type MetricCardinality = 'fixed' | 'low';

export interface MetricRegistryEntry {
  /** Physical name. Only here — nowhere else — does the `oficina.` namespace appear. */
  key: string;
  aggregation: AggregationOption;
}

export interface MetricAttributeRegistryEntry {
  key: string;
  cardinality: MetricCardinality;
}

const OWNED_NAMESPACE = 'oficina';

export const METRIC_REGISTRY: Readonly<Record<BusinessMetricName, MetricRegistryEntry>> = {
  'work_order.created': {
    key: `${OWNED_NAMESPACE}.work_order.created`,
    aggregation: { type: AggregationType.DEFAULT },
  },
  'work_order.status.duration': {
    key: `${OWNED_NAMESPACE}.work_order.status.duration`,
    aggregation: { type: AggregationType.EXPONENTIAL_HISTOGRAM },
  },
  'work_order.diagnosis_to_completion.duration': {
    key: `${OWNED_NAMESPACE}.work_order.diagnosis_to_completion.duration`,
    aggregation: { type: AggregationType.EXPONENTIAL_HISTOGRAM },
  },
  'work_order.lead_time.duration': {
    key: `${OWNED_NAMESPACE}.work_order.lead_time.duration`,
    aggregation: { type: AggregationType.EXPONENTIAL_HISTOGRAM },
  },
};

export const METRIC_ATTRIBUTE_REGISTRY: Readonly<
  Record<MetricAttributeName, MetricAttributeRegistryEntry>
> = {
  workOrderStatus: { key: `${OWNED_NAMESPACE}.work_order.status`, cardinality: 'low' },
};

/**
 * Entries with the default aggregation produce no View — a "default" View would
 * be noise with no effect.
 */
export const METRIC_VIEWS: readonly ViewOptions[] = Object.values(METRIC_REGISTRY)
  .filter((entry) => entry.aggregation.type !== AggregationType.DEFAULT)
  .map((entry) => ({ instrumentName: entry.key, aggregation: entry.aggregation }));

export function resolveMetricKey(name: BusinessMetricName): string {
  return METRIC_REGISTRY[name].key;
}

export function resolveMetricAttribute(name: string): MetricAttributeRegistryEntry | undefined {
  return METRIC_ATTRIBUTE_REGISTRY[name as MetricAttributeName];
}
