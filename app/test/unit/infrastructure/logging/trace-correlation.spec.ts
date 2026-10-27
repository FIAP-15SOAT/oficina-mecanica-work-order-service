import { Span, SpanContext, trace, TraceFlags } from '@opentelemetry/api';

import { buildTraceCorrelation } from '@infrastructure/logging/trace-correlation';

const TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736';
const SPAN_ID = '00f067aa0ba902b7';

function withSpanContext(spanContext: SpanContext | undefined): jest.SpyInstance {
  const span = spanContext ? ({ spanContext: () => spanContext } as Span) : undefined;

  return jest.spyOn(trace, 'getSpan').mockReturnValue(span);
}

describe('buildTraceCorrelation', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  /**
   * Absence is the contract: an empty or synthetic identifier is worse than a
   * missing field, because it leads the destination to correlate with a trace
   * that does not exist. That is the case of the bootstrap and shutdown lines.
   */
  it('should return an empty object when there is no active span', () => {
    withSpanContext(undefined);

    expect(buildTraceCorrelation()).toEqual({});
  });

  it('should return an empty object when the span context is invalid', () => {
    withSpanContext({
      traceId: '00000000000000000000000000000000',
      spanId: '0000000000000000',
      traceFlags: TraceFlags.NONE,
    });

    expect(buildTraceCorrelation()).toEqual({});
  });

  it('should emit the real identifiers using the non-OTLP mapping spelling', () => {
    withSpanContext({ traceId: TRACE_ID, spanId: SPAN_ID, traceFlags: TraceFlags.SAMPLED });

    expect(buildTraceCorrelation()).toEqual({
      trace_id: TRACE_ID,
      span_id: SPAN_ID,
      trace_flags: '01',
    });
  });

  /**
   * `trace_flags` is a two-hex-digit **string**, not a number: the field
   * dictionary declares `string`, and emitting the raw value would break the
   * E2E type assertion.
   */
  it('should emit trace_flags as a two-digit hexadecimal string', () => {
    withSpanContext({ traceId: TRACE_ID, spanId: SPAN_ID, traceFlags: TraceFlags.NONE });

    expect(buildTraceCorrelation().trace_flags).toBe('00');
  });

  it('should not add any key beyond the three correlation fields', () => {
    withSpanContext({ traceId: TRACE_ID, spanId: SPAN_ID, traceFlags: TraceFlags.SAMPLED });

    expect(Object.keys(buildTraceCorrelation()).sort()).toEqual([
      'span_id',
      'trace_flags',
      'trace_id',
    ]);
  });
});
