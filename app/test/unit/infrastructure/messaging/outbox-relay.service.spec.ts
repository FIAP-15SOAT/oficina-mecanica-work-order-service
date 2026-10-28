import { context, propagation, trace } from '@opentelemetry/api';
import {
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-node';
import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';

import { TECHNICAL_EVENTS } from '@infrastructure/logging/technical-event.catalog';
import { messagingLogBindings } from '@infrastructure/messaging/messaging-log-bindings';
import {
  OUTBOX_BATCH_BUDGET_MS,
  OUTBOX_POLL_INTERVAL_MS,
  OutboxRelayService,
} from '@infrastructure/messaging/outbox-relay.service';
import { PrismaService } from '@infrastructure/persistence/prisma/prisma.service';
import { createMockLogger } from '../../../helpers/logger-mock.factory';

interface OutboxRow {
  id: bigint;
  messageId: string;
  type: string;
  workOrderId: string | null;
  payload: object;
  traceContext: Record<string, string>;
  createdAt: Date;
}

const TOPIC_ARN = 'arn:aws:sns:us-east-1:000000000000:oficina-events.fifo';

function createRow(id: number, overrides: Partial<OutboxRow> = {}): OutboxRow {
  return {
    id: BigInt(id),
    messageId: `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`,
    type: 'inventory.stock.reserved',
    workOrderId: 'wo-1',
    payload: { quoteId: 'q-1' },
    traceContext: {},
    createdAt: new Date('2026-10-24T12:00:00.000Z'),
    ...overrides,
  };
}

function createPrisma(rows: OutboxRow[], locked = true) {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([{ locked }]),
    outboxMessage: {
      findMany: jest.fn(({ take }: { take: number }) =>
        Promise.resolve([...rows].sort((a, b) => Number(a.id - b.id)).slice(0, take)),
      ),
      deleteMany: jest.fn(({ where }: { where: { id: { in: bigint[] } } }) => {
        for (const id of where.id.in) {
          rows.splice(
            rows.findIndex((row) => row.id === id),
            1,
          );
        }
        return Promise.resolve({ count: where.id.in.length });
      }),
    },
  };
  const prisma = {
    $transaction: jest.fn((work: (client: typeof tx) => Promise<unknown>) => work(tx)),
  };
  return { prisma, tx };
}

describe('OutboxRelayService', () => {
  let sns: { send: jest.Mock };
  let pinoLogger: { runInContext: jest.Mock };
  let logger: ReturnType<typeof createMockLogger>;

  function createRelay(prisma: unknown): OutboxRelayService {
    return new OutboxRelayService(
      prisma as PrismaService,
      sns as unknown as SNSClient,
      new ConfigService({ MESSAGING_TOPIC_ARN: TOPIC_ARN }),
      pinoLogger as unknown as PinoLogger,
      logger,
    );
  }

  function publishedInputs(): PublishCommand['input'][] {
    return sns.send.mock.calls.map(([command]) => (command as PublishCommand).input);
  }

  beforeEach(() => {
    sns = { send: jest.fn().mockResolvedValue({}) };
    pinoLogger = { runInContext: jest.fn((fn: () => unknown) => fn()) };
    logger = createMockLogger();
  });

  describe('runBatch', () => {
    it('should publish rows in id order to the topic from MESSAGING_TOPIC_ARN and delete them', async () => {
      const rows = [createRow(2), createRow(1)];
      const { prisma, tx } = createPrisma(rows);

      await createRelay(prisma).runBatch();

      expect(publishedInputs().map((input) => input.TopicArn)).toEqual([TOPIC_ARN, TOPIC_ARN]);
      expect(publishedInputs().map((input) => input.MessageDeduplicationId)).toEqual([
        createRow(1).messageId,
        createRow(2).messageId,
      ]);
      expect(tx.outboxMessage.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: [1n, 2n] } },
      });
      expect(rows).toEqual([]);
    });

    it('should publish 25 pending rows in batches of 10, 10 and 5', async () => {
      const rows = Array.from({ length: 25 }, (_, index) => createRow(index + 1));
      const relay = createRelay(createPrisma(rows).prisma);
      const sizes: number[] = [];

      for (let batch = 0; batch < 3; batch++) {
        const before = sns.send.mock.calls.length;
        await relay.runBatch();
        sizes.push(sns.send.mock.calls.length - before);
      }

      expect(sizes).toEqual([10, 10, 5]);
      expect(rows).toEqual([]);
    });

    it('should stop at the first failed publish, keep that row and the next ones and log messaging.outbox.publish_failed with the messaging bindings', async () => {
      const rows = [1, 2, 3, 4, 5].map((id) => createRow(id));
      const { prisma, tx } = createPrisma(rows);
      const error = new Error('sns unavailable');
      sns.send.mockResolvedValueOnce({}).mockResolvedValueOnce({}).mockRejectedValueOnce(error);

      await createRelay(prisma).runBatch();

      expect(sns.send).toHaveBeenCalledTimes(3);
      expect(tx.outboxMessage.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: [1n, 2n] } },
      });
      expect(rows.map((row) => row.id)).toEqual([3n, 4n, 5n]);
      expect(logger.event).toHaveBeenCalledWith(
        TECHNICAL_EVENTS.MESSAGING_OUTBOX_PUBLISH_FAILED,
        {},
        error,
      );
      expect(pinoLogger.runInContext).toHaveBeenCalledWith(expect.any(Function), {
        bindings: messagingLogBindings({
          system: 'aws_sns',
          destination: 'oficina-events.fifo',
          messageId: createRow(3).messageId,
          operation: 'publish',
          type: 'inventory.stock.reserved',
          workOrderId: 'wo-1',
        }),
      });
    });

    it('should stop publishing once the batch budget is spent and delete what it published', async () => {
      const rows = [1, 2, 3, 4].map((id) => createRow(id));
      const { prisma, tx } = createPrisma(rows);
      let now = 0;
      const clock = jest.spyOn(Date, 'now').mockImplementation(() => now);
      sns.send.mockImplementation(() => {
        now += OUTBOX_BATCH_BUDGET_MS * 0.6;
        return Promise.resolve({});
      });

      await createRelay(prisma).runBatch();
      clock.mockRestore();

      expect(sns.send).toHaveBeenCalledTimes(2);
      expect(tx.outboxMessage.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: [1n, 2n] } },
      });
      expect(rows.map((row) => row.id)).toEqual([3n, 4n]);
    });

    it('should not delete anything when the first publish fails', async () => {
      const rows = [createRow(1)];
      const { prisma, tx } = createPrisma(rows);
      sns.send.mockRejectedValueOnce(new Error('sns unavailable'));

      await createRelay(prisma).runBatch();

      expect(tx.outboxMessage.deleteMany).not.toHaveBeenCalled();
      expect(rows).toHaveLength(1);
    });

    it('should skip the batch when another replica holds the relay lock', async () => {
      const { prisma, tx } = createPrisma([createRow(1)], false);

      await createRelay(prisma).runBatch();

      expect(tx.outboxMessage.findMany).not.toHaveBeenCalled();
      expect(sns.send).not.toHaveBeenCalled();
    });

    it('should build the envelope and the FIFO ids', async () => {
      const withWorkOrder = createRow(1);
      const withoutWorkOrder = createRow(2, { type: 'notification.email.send', workOrderId: null });

      await createRelay(createPrisma([withWorkOrder, withoutWorkOrder]).prisma).runBatch();

      const [first, second] = publishedInputs();
      expect(JSON.parse(first.Message as string)).toEqual({
        messageId: withWorkOrder.messageId,
        type: 'inventory.stock.reserved',
        occurredAt: '2026-10-24T12:00:00.000Z',
        workOrderId: 'wo-1',
        payload: { quoteId: 'q-1' },
      });
      expect(first).toMatchObject({
        MessageGroupId: 'wo-1',
        MessageDeduplicationId: withWorkOrder.messageId,
        MessageAttributes: {
          type: { DataType: 'String', StringValue: 'inventory.stock.reserved' },
        },
      });
      expect(second.MessageGroupId).toBe(withoutWorkOrder.messageId);
    });

    describe('with a tracer provider', () => {
      let provider: NodeTracerProvider;

      beforeAll(() => {
        provider = new NodeTracerProvider({
          spanProcessors: [new SimpleSpanProcessor(new InMemorySpanExporter())],
        });
        provider.register();
      });

      afterAll(async () => {
        await provider.shutdown();
        trace.disable();
        context.disable();
        propagation.disable();
      });

      it('should publish inside the stored trace context', async () => {
        const traceId = '0af7651916cd43dd8448eb211c80319c';
        const row = createRow(1, {
          traceContext: { traceparent: `00-${traceId}-b7ad6b7169203331-01` },
        });
        let activeTraceId: string | undefined;
        sns.send.mockImplementation(() => {
          activeTraceId = trace.getSpanContext(context.active())?.traceId;
          return Promise.resolve({});
        });

        await createRelay(createPrisma([row]).prisma).runBatch();

        expect(activeTraceId).toBe(traceId);
      });
    });
  });

  describe('polling', () => {
    beforeEach(() => jest.useFakeTimers());

    afterEach(() => jest.useRealTimers());

    it('should run a batch on every tick after bootstrap', async () => {
      const { prisma } = createPrisma([]);
      const relay = createRelay(prisma);

      relay.onApplicationBootstrap();
      await jest.advanceTimersByTimeAsync(OUTBOX_POLL_INTERVAL_MS * 2);
      await relay.beforeApplicationShutdown();

      expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    });

    it('should log and keep polling when a batch fails', async () => {
      const error = new Error('database down');
      const prisma = { $transaction: jest.fn().mockRejectedValue(error) };
      const relay = createRelay(prisma);

      relay.onApplicationBootstrap();
      await jest.advanceTimersByTimeAsync(OUTBOX_POLL_INTERVAL_MS * 2);
      await relay.beforeApplicationShutdown();

      expect(logger.error).toHaveBeenCalledWith('outbox relay batch failed', error);
      expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    });

    it('should wait for the in-flight batch on shutdown and schedule no new batch', async () => {
      let finishBatch: () => void = () => undefined;
      const prisma = {
        $transaction: jest.fn(
          () =>
            new Promise<void>((resolve) => {
              finishBatch = resolve;
            }),
        ),
      };
      const relay = createRelay(prisma);
      relay.onApplicationBootstrap();
      await jest.advanceTimersByTimeAsync(OUTBOX_POLL_INTERVAL_MS);

      let resolved = false;
      const shutdown = relay.beforeApplicationShutdown().then(() => {
        resolved = true;
      });
      await jest.advanceTimersByTimeAsync(0);
      expect(resolved).toBe(false);

      finishBatch();
      await shutdown;
      await jest.advanceTimersByTimeAsync(OUTBOX_POLL_INTERVAL_MS * 2);

      expect(resolved).toBe(true);
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('should resolve shutdown at once when no batch is in flight', async () => {
      const { prisma } = createPrisma([]);
      const relay = createRelay(prisma);
      relay.onApplicationBootstrap();

      await relay.beforeApplicationShutdown();
      await jest.advanceTimersByTimeAsync(OUTBOX_POLL_INTERVAL_MS);

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });
});
