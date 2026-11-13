import { MetricAttributes } from './metric-attribute';

export type BusinessMetricName =
  | 'work_order.created'
  | 'work_order.status.duration'
  | 'work_order.diagnosis_to_completion.duration'
  | 'work_order.lead_time.duration'
  | 'saga.started'
  | 'saga.finished'
  | 'saga.duration';

export type MetricInstrumentKind = 'counter' | 'histogram';

declare const METRIC_ATTRIBUTES: unique symbol;

export interface BusinessMetricDefinition<TAttributes extends MetricAttributes = MetricAttributes> {
  readonly name: BusinessMetricName;
  readonly kind: MetricInstrumentKind;
  readonly unit: string;
  readonly description: string;
  readonly [METRIC_ATTRIBUTES]?: TAttributes;
}

export function defineBusinessMetric<TAttributes extends MetricAttributes>(
  definition: BusinessMetricDefinition<TAttributes>,
): BusinessMetricDefinition<TAttributes> {
  return definition;
}
