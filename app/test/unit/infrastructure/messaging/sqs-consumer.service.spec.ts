import { context, metrics, propagation, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';
import { isTracingSuppressed, suppressTracing } from '@opentelemetry/core';
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics';
import {
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-node';
import { GetQueueUrlCommand, Message, SQSClient } from '@aws-sdk/client-sqs';
import { ConfigService } from '@nestjs/config';
import { IsUUID } from 'class-validator';
import { PinoLogger } from 'nestjs-pino';
import { Consumer } from 'sqs-consumer';

import { TECHNICAL_EVENTS } from '@infrastructure/logging/technical-event.catalog';
import { MessageHandlerRegistry } from '@infrastructure/messaging/message-handler.registry';
import { messagingLogBindings } from '@infrastructure/messaging/messaging-log-bindings';
import {
  RECEIVE_FAILURE_PAUSE_MS,
  SqsConsumerService,
} from '@infrastructure/messaging/sqs-consumer.service';
import { createMockLogger } from '../../../helpers/logger-mock.factory';

jest.mock('sqs-consumer');

const QUEUE_URL = 'http://localhost:4566/000000000000/work-order.fifo';
const MESSAGE_ID = '6f1c1a8e-3b9a-4c1e-9c51-2f9d6f3b7a10';
const WORK_ORDER_ID = '2a7c4d1e-8f3b-4a6c-9d2e-5b1f0c7e3a94';
const QUOTE_ID = '9b3e2f1a-7c6d-4e5f-8a9b-0c1d2e3f4a5b';
const TRACE_ID = '0af7651916cd43dd8448eb211c80319c';
const PARENT_SPAN_ID = 'b7ad6b7169203331';

class ReservedPayload {
  @IsUUID('4')
  quoteId!: string;
}

class ConsumePayload {}

function createMessage(
  body: Record<string, unknown> = {},
  receiveCount = 1,
  options: { traceparent?: boolean } = {},
): Message {
  return {
    MessageId: 'sqs-message-id',
    Body: JSON.stringify({
      messageId: MESSAGE_ID,
      type: 'inventory.stock.reserved',
      occurredAt: '2026-10-24T12:00:00.000Z',
      workOrderId: WORK_ORDER_ID,
      payload: { quoteId: QUOTE_ID },
      ...body,
    }),
    Attributes: { ApproximateReceiveCount: String(receiveCount) },
    MessageAttributes: options.traceparent
      ? {
          traceparent: { DataType: 'String', StringValue: `00-${TRACE_ID}-${PARENT_SPAN_ID}-01` },
        }
      : {},
  };
}

describe('SqsConsumerService', () => {
  let spanExporter: InMemorySpanExporter;
  let tracerProvider: NodeTracerProvider;
  let metricReader: PeriodicExportingMetricReader;
  let meterProvider: MeterProvider;
  let sqs: { send: jest.Mock };
  let registry: MessageHandlerRegistry;
  let pinoLogger: { runInContext: jest.Mock };
  let logger: ReturnType<typeof createMockLogger>;
  let service: SqsConsumerService;
  let consumer: { start: jest.Mock; stop: jest.Mock; on: jest.Mock; once: jest.Mock };

  beforeAll(() => {
    spanExporter = new InMemorySpanExporter();
    tracerProvider = new NodeTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(spanExporter)],
    });
    tracerProvider.register();
    metricReader = new PeriodicExportingMetricReader({
      exporter: new InMemoryMetricExporter(AggregationTemporality.DELTA),
      exportIntervalMillis: 600_000,
    });
    meterProvider = new MeterProvider({ readers: [metricReader] });
    metrics.setGlobalMeterProvider(meterProvider);
  });

  afterAll(async () => {
    await tracerProvider.shutdown();
    await meterProvider.shutdown();
    trace.disable();
    context.disable();
    propagation.disable();
    metrics.disable();
  });

  beforeEach(async () => {
    await metricReader.collect();
    spanExporter.reset();
    sqs = { send: jest.fn().mockResolvedValue({ QueueUrl: QUEUE_URL }) };
    registry = new MessageHandlerRegistry();
    pinoLogger = { runInContext: jest.fn((fn: () => unknown) => fn()) };
    logger = createMockLogger();
    consumer = { start: jest.fn(), stop: jest.fn(), on: jest.fn(), once: jest.fn() };
    (Consumer.create as jest.Mock).mockReturnValue(consumer);
    service = new SqsConsumerService(
      sqs as unknown as SQSClient,
      registry,
      { getOrThrow: jest.fn().mockReturnValue('work-order.fifo') } as unknown as ConfigService,
      pinoLogger as unknown as PinoLogger,
      logger,
    );
  });

  async function consumedCounts(): Promise<Record<string, number>> {
    const { resourceMetrics } = await metricReader.collect();
    const metric = resourceMetrics.scopeMetrics
      .flatMap((scope) => scope.metrics)
      .find((candidate) => candidate.descriptor.name === 'oficina.messaging.consumed');
    const counts: Record<string, number> = {};
    for (const point of metric?.dataPoints ?? []) {
      expect(point.attributes['messaging.destination.name']).toBe('work-order.fifo');
      counts[point.attributes.outcome as string] = point.value as number;
    }
    return counts;
  }

  describe('onApplicationBootstrap', () => {
    it('should resolve the queue URL from WORK_ORDER_QUEUE_NAME and start the consumer', async () => {
      await service.onApplicationBootstrap();

      const command = sqs.send.mock.calls[0][0] as GetQueueUrlCommand;
      expect(command).toBeInstanceOf(GetQueueUrlCommand);
      expect(command.input).toEqual({ QueueName: 'work-order.fifo' });
      expect(Consumer.create).toHaveBeenCalledWith(
        expect.objectContaining({
          queueUrl: QUEUE_URL,
          sqs,
          batchSize: 1,
          waitTimeSeconds: 20,
          messageSystemAttributeNames: ['ApproximateReceiveCount'],
          messageAttributeNames: ['All'],
          suppressFifoWarning: true,
          pollingCompleteWaitTimeMs: 5_000,
          authenticationErrorTimeout: 0,
        }),
      );
      expect(consumer.start).toHaveBeenCalled();
    });

    it('should start polling with tracing suppressed, so receive and delete calls create no spans', async () => {
      let suppressed: boolean | undefined;

      consumer.start.mockImplementation(() => {
        suppressed = isTracingSuppressed(context.active());
      });

      await service.onApplicationBootstrap();

      expect(suppressed).toBe(true);
    });

    it('should log errors from the consumer', async () => {
      await service.onApplicationBootstrap();
      const error = new Error('access denied');

      const [event, listener] = consumer.on.mock.calls[0] as [string, (error: Error) => void];
      listener(error);

      expect(event).toBe('error');
      expect(logger.error).toHaveBeenCalledWith('sqs consumer error', error);
    });

    it('should not log the requests the shutdown abort cancels', async () => {
      await service.onApplicationBootstrap();
      const [, listener] = consumer.on.mock.calls[0] as [string, (error: Error) => void];

      void service.beforeApplicationShutdown();
      listener(new Error('Request aborted'));

      expect(logger.error).not.toHaveBeenCalled();
    });

    it('should hand received messages to handleMessage', async () => {
      await service.onApplicationBootstrap();
      const handler = jest.fn().mockResolvedValue(undefined);
      registry.register('inventory.stock.reserved', handler, ReservedPayload);
      const message = createMessage();

      const { handleMessage } = (Consumer.create as jest.Mock).mock.lastCall?.[0] as {
        handleMessage: (message: Message) => Promise<Message>;
      };

      await expect(handleMessage(message)).resolves.toBe(message);
    });
  });

  describe('pause after a failed receive', () => {
    type ErrorListener = (error: Error, message?: Message) => void;

    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    async function bootstrap(): Promise<{
      beforeReceive: () => Promise<void>;
      onError: ErrorListener;
    }> {
      await service.onApplicationBootstrap();

      const { preReceiveMessageCallback } = (Consumer.create as jest.Mock).mock.lastCall?.[0] as {
        preReceiveMessageCallback: () => Promise<void>;
      };

      const [, onError] = consumer.on.mock.calls.find(([event]) => event === 'error') as [
        string,
        ErrorListener,
      ];

      return { beforeReceive: preReceiveMessageCallback, onError };
    }

    function track(promise: Promise<void>): { done: boolean } {
      const state = { done: false };

      void promise.then(() => {
        state.done = true;
      });

      return state;
    }

    it('should receive at once when the last receive did not fail', async () => {
      const { beforeReceive } = await bootstrap();

      const receive = track(beforeReceive());
      await jest.advanceTimersByTimeAsync(0);

      expect(receive.done).toBe(true);
    });

    it('should hold the next receive for 10 s after a failed receive', async () => {
      const { beforeReceive, onError } = await bootstrap();
      onError(new Error('connect ECONNREFUSED'));

      const receive = track(beforeReceive());
      await jest.advanceTimersByTimeAsync(RECEIVE_FAILURE_PAUSE_MS - 1);
      const heldBeforeTheEnd = !receive.done;
      await jest.advanceTimersByTimeAsync(1);

      expect(RECEIVE_FAILURE_PAUSE_MS).toBe(10_000);
      expect(heldBeforeTheEnd).toBe(true);
      expect(receive.done).toBe(true);
    });

    it('should pause once per failed receive', async () => {
      const { beforeReceive, onError } = await bootstrap();
      onError(new Error('connect ECONNREFUSED'));
      void beforeReceive();
      await jest.advanceTimersByTimeAsync(RECEIVE_FAILURE_PAUSE_MS);

      const receive = track(beforeReceive());
      await jest.advanceTimersByTimeAsync(0);

      expect(receive.done).toBe(true);
    });

    it('should not pause after a failure tied to a message', async () => {
      const { beforeReceive, onError } = await bootstrap();
      onError(new Error('delete failed'), createMessage());

      const receive = track(beforeReceive());
      await jest.advanceTimersByTimeAsync(0);

      expect(receive.done).toBe(true);
    });

    it('should end the pause on shutdown', async () => {
      const { beforeReceive, onError } = await bootstrap();
      onError(new Error('connect ECONNREFUSED'));
      const receive = track(beforeReceive());

      void service.beforeApplicationShutdown();
      await jest.advanceTimersByTimeAsync(0);

      expect(receive.done).toBe(true);
    });
  });

  describe('handleMessage', () => {
    it('should call the handler with the parsed envelope and acknowledge', async () => {
      const handler = jest.fn().mockResolvedValue(undefined);
      registry.register('inventory.stock.reserved', handler, ReservedPayload);
      const message = createMessage();

      await expect(service.handleMessage(message)).resolves.toBe(message);

      expect(handler).toHaveBeenCalledWith({
        messageId: MESSAGE_ID,
        type: 'inventory.stock.reserved',
        occurredAt: '2026-10-24T12:00:00.000Z',
        workOrderId: WORK_ORDER_ID,
        payload: { quoteId: QUOTE_ID },
      });
    });

    it('should treat a message without attributes as a first delivery without trace parent', async () => {
      const handler = jest.fn().mockResolvedValue(undefined);

      registry.register('inventory.stock.reserved', handler, ReservedPayload);

      const { MessageId, Body } = createMessage();

      await expect(service.handleMessage({ MessageId, Body })).resolves.toEqual({
        MessageId,
        Body,
      });

      const [span] = spanExporter.getFinishedSpans();
      expect(span.parentSpanContext).toBeUndefined();
    });

    it('should accept an envelope without work order', async () => {
      const handler = jest.fn().mockResolvedValue(undefined);

      registry.register('inventory.stock.reserved', handler, ReservedPayload);

      const message = createMessage({ workOrderId: null });

      await expect(service.handleMessage(message)).resolves.toBe(message);
    });

    it('should not acknowledge a valid message without handler, log messaging.message.unhandled and count outcome retry', async () => {
      await expect(service.handleMessage(createMessage())).rejects.toThrow(
        'inventory.stock.reserved',
      );

      expect(logger.event).toHaveBeenCalledWith(TECHNICAL_EVENTS.MESSAGING_MESSAGE_UNHANDLED, {});
      expect(await consumedCounts()).toEqual({ retry: 1 });
    });

    it('should log messaging.message.dead_lettered for a message without handler on its last delivery', async () => {
      await expect(service.handleMessage(createMessage({}, 5))).rejects.toThrow();

      expect(logger.event).toHaveBeenCalledWith(
        TECHNICAL_EVENTS.MESSAGING_MESSAGE_DEAD_LETTERED,
        {},
        expect.any(Error),
      );
      expect(logger.event).not.toHaveBeenCalledWith(
        TECHNICAL_EVENTS.MESSAGING_MESSAGE_UNHANDLED,
        {},
      );
      expect(await consumedCounts()).toEqual({ dead_lettered: 1 });
    });

    it('should not acknowledge an envelope without messageId', async () => {
      registry.register('inventory.stock.reserved', jest.fn(), ReservedPayload);

      await expect(service.handleMessage(createMessage({ messageId: undefined }))).rejects.toThrow(
        'messageId',
      );

      expect(logger.event).toHaveBeenCalledWith(
        TECHNICAL_EVENTS.MESSAGING_MESSAGE_FAILED,
        {},
        expect.any(Error),
      );
    });

    it('should not acknowledge an occurredAt outside ISO-8601', async () => {
      registry.register('inventory.stock.reserved', jest.fn(), ReservedPayload);

      await expect(
        service.handleMessage(createMessage({ occurredAt: '05/11/2026' })),
      ).rejects.toThrow('occurredAt');

      expect(logger.event).toHaveBeenCalledWith(
        TECHNICAL_EVENTS.MESSAGING_MESSAGE_FAILED,
        {},
        expect.any(Error),
      );
    });

    it('should not acknowledge a body that is not JSON', async () => {
      await expect(
        service.handleMessage({ ...createMessage(), Body: 'not json' }),
      ).rejects.toThrow();

      expect(logger.event).toHaveBeenCalledWith(
        TECHNICAL_EVENTS.MESSAGING_MESSAGE_FAILED,
        {},
        expect.any(Error),
      );
    });

    it('should not acknowledge a message without body', async () => {
      const { Body: _body, ...withoutBody } = createMessage();

      await expect(service.handleMessage(withoutBody)).rejects.toThrow();

      expect(logger.event).toHaveBeenCalledWith(
        TECHNICAL_EVENTS.MESSAGING_MESSAGE_FAILED,
        {},
        expect.any(Error),
      );
    });

    it('should accept an empty payload when the handler payload class declares no fields', async () => {
      const handler = jest.fn().mockResolvedValue(undefined);

      registry.register('inventory.stock.consume', handler, ConsumePayload);

      const message = createMessage({ type: 'inventory.stock.consume', payload: {} });

      await expect(service.handleMessage(message)).resolves.toBe(message);
      expect(handler).toHaveBeenCalled();
    });

    it('should not acknowledge a payload rejected by the handler payload class', async () => {
      const handler = jest.fn();
      registry.register('inventory.stock.reserved', handler, ReservedPayload);

      await expect(
        service.handleMessage(createMessage({ payload: { quoteId: 'not-a-uuid' } })),
      ).rejects.toThrow('quoteId');

      expect(handler).not.toHaveBeenCalled();
      expect(logger.event).toHaveBeenCalledWith(
        TECHNICAL_EVENTS.MESSAGING_MESSAGE_FAILED,
        {},
        expect.any(Error),
      );
    });

    it('should rethrow a handler failure and log messaging.message.failed when ApproximateReceiveCount is below 5', async () => {
      const error = new Error('use case failed');

      registry.register(
        'inventory.stock.reserved',
        jest.fn().mockRejectedValue(error),
        ReservedPayload,
      );

      await expect(service.handleMessage(createMessage({}, 4))).rejects.toBe(error);

      expect(logger.event).toHaveBeenCalledWith(
        TECHNICAL_EVENTS.MESSAGING_MESSAGE_FAILED,
        {},
        error,
      );
      expect(logger.event).not.toHaveBeenCalledWith(
        TECHNICAL_EVENTS.MESSAGING_MESSAGE_DEAD_LETTERED,
        {},
        error,
      );
    });

    it('should log messaging.message.dead_lettered and rethrow when ApproximateReceiveCount is 5', async () => {
      const error = new Error('use case failed');

      registry.register(
        'inventory.stock.reserved',
        jest.fn().mockRejectedValue(error),
        ReservedPayload,
      );

      await expect(service.handleMessage(createMessage({}, 5))).rejects.toBe(error);

      expect(logger.event).toHaveBeenCalledWith(
        TECHNICAL_EVENTS.MESSAGING_MESSAGE_DEAD_LETTERED,
        {},
        error,
      );
      expect(logger.event).not.toHaveBeenCalledWith(
        TECHNICAL_EVENTS.MESSAGING_MESSAGE_FAILED,
        {},
        error,
      );
    });

    it('should still trace the message and its handler when the polling context suppresses tracing', async () => {
      let handlerSuppressed: boolean | undefined;

      registry.register(
        'inventory.stock.reserved',
        jest.fn(() => {
          handlerSuppressed = isTracingSuppressed(context.active());
          return Promise.resolve();
        }),
        ReservedPayload,
      );

      await context.with(suppressTracing(context.active()), () =>
        service.handleMessage(createMessage({}, 1, { traceparent: true })),
      );

      const [span] = spanExporter.getFinishedSpans();

      expect(span.name).toBe('process work-order.fifo');

      expect(span.spanContext().traceId).toBe(TRACE_ID);

      expect(handlerSuppressed).toBe(false);
    });

    it('should open a CONSUMER span named process work-order.fifo, child of the traceparent attribute', async () => {
      registry.register(
        'inventory.stock.reserved',
        jest.fn().mockResolvedValue(undefined),
        ReservedPayload,
      );

      await service.handleMessage(createMessage({}, 1, { traceparent: true }));

      const [span] = spanExporter.getFinishedSpans();
      expect(span.name).toBe('process work-order.fifo');
      expect(span.kind).toBe(SpanKind.CONSUMER);
      expect(span.spanContext().traceId).toBe(TRACE_ID);
      expect(span.parentSpanContext?.spanId).toBe(PARENT_SPAN_ID);
      expect(span.attributes).toEqual({
        'messaging.system': 'aws_sqs',
        'messaging.destination.name': 'work-order.fifo',
        'messaging.message.id': MESSAGE_ID,
        'messaging.operation.type': 'process',
      });
      expect(span.status.code).not.toBe(SpanStatusCode.ERROR);
    });

    it('should mark the CONSUMER span as failed with the exception', async () => {
      registry.register(
        'inventory.stock.reserved',
        jest.fn().mockRejectedValue(new Error('use case failed')),
        ReservedPayload,
      );

      await expect(service.handleMessage(createMessage())).rejects.toThrow();

      const [span] = spanExporter.getFinishedSpans();
      expect(span.status.code).toBe(SpanStatusCode.ERROR);
      expect(span.events.map((event) => event.name)).toEqual(['exception']);
    });

    it('should bind messaging fields and request.id to the processing context', async () => {
      registry.register(
        'inventory.stock.reserved',
        jest.fn().mockResolvedValue(undefined),
        ReservedPayload,
      );

      await service.handleMessage(createMessage());

      expect(pinoLogger.runInContext).toHaveBeenCalledWith(expect.any(Function), {
        bindings: messagingLogBindings({
          system: 'aws_sqs',
          destination: 'work-order.fifo',
          messageId: MESSAGE_ID,
          operation: 'process',
          type: 'inventory.stock.reserved',
          workOrderId: WORK_ORDER_ID,
        }),
      });
    });

    it('should bind the SQS message id when the envelope is invalid', async () => {
      await expect(
        service.handleMessage({ ...createMessage(), Body: 'not json' }),
      ).rejects.toThrow();

      expect(pinoLogger.runInContext).toHaveBeenCalledWith(expect.any(Function), {
        bindings: messagingLogBindings({
          system: 'aws_sqs',
          destination: 'work-order.fifo',
          messageId: 'sqs-message-id',
          operation: 'process',
        }),
      });
    });

    it('should count oficina.messaging.consumed with outcome success, retry and dead_lettered', async () => {
      const handler = jest
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('retry'))
        .mockRejectedValueOnce(new Error('give up'));
      registry.register('inventory.stock.reserved', handler, ReservedPayload);

      await service.handleMessage(createMessage());
      await service.handleMessage(createMessage({}, 2)).catch(() => undefined);
      await service.handleMessage(createMessage({}, 5)).catch(() => undefined);

      expect(await consumedCounts()).toEqual({ success: 1, retry: 1, dead_lettered: 1 });
    });
  });

  describe('beforeApplicationShutdown', () => {
    it('should stop with abort and resolve after the stopped event', async () => {
      await service.onApplicationBootstrap();
      let resolved = false;

      const shutdown = service.beforeApplicationShutdown().then(() => {
        resolved = true;
      });
      await Promise.resolve();

      expect(consumer.stop).toHaveBeenCalledWith({ abort: true });
      const [event, onStopped] = consumer.once.mock.calls[0] as [string, () => void];
      expect(event).toBe('stopped');
      expect(resolved).toBe(false);

      onStopped();
      await shutdown;
      expect(resolved).toBe(true);
    });

    it('should resolve at once when the consumer never started', async () => {
      await expect(service.beforeApplicationShutdown()).resolves.toBeUndefined();
    });
  });
});
