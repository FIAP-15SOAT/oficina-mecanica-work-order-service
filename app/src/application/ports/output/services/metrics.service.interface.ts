import { BusinessMetricDefinition } from '@application/metrics/business-metric';
import { MetricAttributes } from '@application/metrics/metric-attribute';

import { NoExtraFields } from './no-extra-fields';

export interface IMetrics {
  increment<TAttributes extends MetricAttributes, TGiven extends TAttributes>(
    definition: BusinessMetricDefinition<TAttributes>,
    attributes: NoExtraFields<TAttributes, TGiven>,
  ): void;
  record<TAttributes extends MetricAttributes, TGiven extends TAttributes>(
    definition: BusinessMetricDefinition<TAttributes>,
    value: number,
    attributes: NoExtraFields<TAttributes, TGiven>,
  ): void;
}
