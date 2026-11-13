export type MetricAttributeName = 'workOrderStatus' | 'sagaType' | 'sagaOutcome';

export type MetricAttributes = Partial<Record<MetricAttributeName, unknown>>;
