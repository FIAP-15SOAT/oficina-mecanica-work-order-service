import { context, isSpanContextValid, trace } from '@opentelemetry/api';

export interface TraceCorrelationFields {
  trace_id?: string;
  span_id?: string;
  trace_flags?: string;
}

export function buildTraceCorrelation(): TraceCorrelationFields {
  const spanContext = trace.getSpan(context.active())?.spanContext();

  if (!spanContext || !isSpanContextValid(spanContext)) {
    return {};
  }

  return {
    trace_id: spanContext.traceId,
    span_id: spanContext.spanId,
    // Two-hex-digit string, as the convention requires: `01` for sampled.
    // Emitting the raw number would break the type declared in the dictionary.
    trace_flags: spanContext.traceFlags.toString(16).padStart(2, '0'),
  };
}
