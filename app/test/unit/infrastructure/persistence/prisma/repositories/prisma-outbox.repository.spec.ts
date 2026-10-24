import { context, propagation, trace } from '@opentelemetry/api';
import {
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-node';
import { PrismaOutboxRepository } from '@infrastructure/persistence/prisma/repositories/prisma-outbox.repository';
import {
  createMockPrismaClient,
  MockPrismaService,
} from '../../../../../helpers/prisma-mock.factory';

describe('PrismaOutboxRepository', () => {
  let repository: PrismaOutboxRepository;
  let prisma: MockPrismaService;

  beforeEach(() => {
    prisma = createMockPrismaClient();
    repository = new PrismaOutboxRepository(prisma);
  });

  describe('add', () => {
    it('should create the outbox row with type, workOrderId and payload', async () => {
      await repository.add({
        type: 'inventory.stock.reserved',
        workOrderId: 'wo-1',
        payload: { quoteId: 'q-1' },
      });

      expect(prisma.outboxMessage.create).toHaveBeenCalledWith({
        data: {
          type: 'inventory.stock.reserved',
          workOrderId: 'wo-1',
          payload: { quoteId: 'q-1' },
          traceContext: {},
        },
      });
    });

    describe('with an active span', () => {
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

      it('should store the active W3C trace context', async () => {
        const tracer = trace.getTracer('test');
        const spanContext = await tracer.startActiveSpan('write', async (span) => {
          await repository.add({
            type: 'inventory.stock.consume',
            workOrderId: 'wo-1',
            payload: {},
          });
          span.end();
          return span.spanContext();
        });

        const [{ data }] = prisma.outboxMessage.create.mock.calls[0] as [
          { data: { traceContext: Record<string, string> } },
        ];
        expect(data.traceContext.traceparent).toMatch(
          new RegExp(`^00-${spanContext.traceId}-${spanContext.spanId}-01$`),
        );
      });
    });
  });
});
