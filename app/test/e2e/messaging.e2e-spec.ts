import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { IsISO8601, IsString, IsUUID } from 'class-validator';
import {
  GetQueueAttributesCommand,
  GetQueueUrlCommand,
  SetQueueAttributesCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import { MessageEnvelope } from '@application/messaging/message-envelope';
import { IUnitOfWork } from '@domain/interfaces/repositories/unit-of-work.interface';
import { OutboxMessage } from '@domain/messaging/message-catalog';
import { DECLARED_FIELD_NAMES } from '@infrastructure/logging/field-registry';
import { MessageHandlerRegistry } from '@infrastructure/messaging/message-handler.registry';
import { OUTBOX_RELAY_LOCK_KEY } from '@infrastructure/messaging/outbox-relay.service';
import { TestContext, setupTestApp, teardownTestApp } from '../helpers/test-app.helper';

class StockReservedPayload {
  @IsUUID('4')
  quoteId!: string;
}

class PaymentApprovedPayload {
  @IsString()
  paymentId!: string;

  @IsString()
  amount!: string;

  @IsISO8601()
  paidAt!: string;
}

async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeoutMs = 15_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (!(await condition())) {
    if (Date.now() > deadline) {
      throw new Error(`condition not met within ${timeoutMs} ms`);
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

// Every test publishes on its own work order, so a message stuck in one FIFO group never blocks another test.
describe('Messaging (E2E)', () => {
  let ctx: TestContext;
  let unitOfWork: IUnitOfWork;
  let registry: MessageHandlerRegistry;
  let sqs: SQSClient;
  let queueUrl: string;
  let customerId: string;
  let vehicleId: string;
  let workOrderCounter = 0;

  beforeAll(async () => {
    ctx = await setupTestApp({ withMessaging: true, captureLogs: true });
    unitOfWork = ctx.app.get<IUnitOfWork>('IUnitOfWork');
    registry = ctx.app.get(MessageHandlerRegistry);
    sqs = ctx.app.get(SQSClient);

    const { QueueUrl } = await sqs.send(new GetQueueUrlCommand({ QueueName: 'work-order.fifo' }));
    queueUrl = QueueUrl as string;

    // A failed delivery comes back in 2 s instead of 30 s.
    await sqs.send(
      new SetQueueAttributesCommand({
        QueueUrl: queueUrl,
        Attributes: { VisibilityTimeout: '2' },
      }),
    );

    const customer = await ctx.prisma.customer.create({
      data: {
        name: 'Cliente Mensageria',
        document: '52998224725',
        email: 'mensageria@e2e.test',
        phone: '11999999999',
      },
    });

    const vehicle = await ctx.prisma.vehicle.create({
      data: { customerId: customer.id, plate: 'MSG1A23', brand: 'Fiat', model: 'Uno', year: 2020 },
    });

    customerId = customer.id;
    vehicleId = vehicle.id;
  });

  afterAll(async () => {
    await teardownTestApp(ctx);
  });

  async function createWorkOrder(): Promise<string> {
    const workOrder = await ctx.prisma.workOrder.create({
      data: {
        number: `9${(++workOrderCounter).toString().padStart(5, '0')}`,
        customerId,
        vehicleId,
      },
    });

    return workOrder.id;
  }

  function addMessage(message: OutboxMessage): Promise<void> {
    return unitOfWork.executeTransaction((repositories) => repositories.outbox.add(message));
  }

  function countOutbox(workOrderId: string): Promise<number> {
    return ctx.prisma.outboxMessage.count({ where: { workOrderId } });
  }

  // Holds the relay's advisory lock from another session until the returned release is called.
  async function holdRelayLock(): Promise<() => Promise<void>> {
    const client = new Client({ connectionString: ctx.postgresContainer.getConnectionUri() });
    await client.connect();
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [OUTBOX_RELAY_LOCK_KEY]);

    return async () => {
      await client.query('COMMIT');
      await client.end();
    };
  }

  it('should publish an outbox message and consume it back through a test handler', async () => {
    const received: MessageEnvelope[] = [];

    registry.register(
      'inventory.stock.reserved',
      (envelope) => {
        received.push(envelope);
        return Promise.resolve();
      },
      StockReservedPayload,
    );

    const workOrderId = await createWorkOrder();
    const quoteId = randomUUID();

    const release = await holdRelayLock();

    await addMessage({ type: 'inventory.stock.reserved', workOrderId, payload: { quoteId } });

    const row = await ctx.prisma.outboxMessage.findFirstOrThrow({ where: { workOrderId } });

    await release();

    await waitFor(() => received.length === 1);

    expect(received[0]).toEqual({
      messageId: row.messageId,
      type: 'inventory.stock.reserved',
      occurredAt: row.createdAt.toISOString(),
      workOrderId,
      payload: { quoteId },
    });

    expect(await countOutbox(workOrderId)).toBe(0);

    await waitFor(async () => {
      const { Attributes } = await sqs.send(
        new GetQueueAttributesCommand({
          QueueUrl: queueUrl,
          AttributeNames: ['ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible'],
        }),
      );

      return (
        Attributes?.ApproximateNumberOfMessages === '0' &&
        Attributes?.ApproximateNumberOfMessagesNotVisible === '0'
      );
    });
  });

  it('should leave no outbox row when the transaction rolls back', async () => {
    const workOrderId = await createWorkOrder();
    // With the relay locked out, a row that wrongly committed would still be in the table.
    const release = await holdRelayLock();

    await expect(
      unitOfWork.executeTransaction(async (repositories) => {
        await repositories.outbox.add({
          type: 'inventory.stock.reserve',
          workOrderId,
          payload: { quoteId: randomUUID(), items: [] },
        });

        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');

    expect(await countOutbox(workOrderId)).toBe(0);

    await release();
  });

  it('should not publish while another transaction holds the relay lock', async () => {
    const workOrderId = await createWorkOrder();
    const release = await holdRelayLock();

    await addMessage({
      type: 'inventory.stock.reserve',
      workOrderId,
      payload: { quoteId: randomUUID(), items: [] },
    });

    await new Promise((resolve) => setTimeout(resolve, 2_000));

    expect(await countOutbox(workOrderId)).toBe(1);

    await release();

    await waitFor(async () => (await countOutbox(workOrderId)) === 0, 5_000);
  });

  it('should keep the group order when the first message fails', async () => {
    const seen: string[] = [];
    let failed = false;

    registry.register(
      'billing.payment.approved',
      ({ payload }) => {
        seen.push(payload.paymentId);

        if (payload.paymentId === 'A' && !failed) {
          failed = true;
          return Promise.reject(new Error('first delivery of A fails'));
        }

        return Promise.resolve();
      },
      PaymentApprovedPayload,
    );

    const workOrderId = await createWorkOrder();
    const paidAt = new Date().toISOString();

    await unitOfWork.executeTransaction(async (repositories) => {
      await repositories.outbox.add({
        type: 'billing.payment.approved',
        workOrderId,
        payload: { paymentId: 'A', amount: '10.00', paidAt },
      });

      await repositories.outbox.add({
        type: 'billing.payment.approved',
        workOrderId,
        payload: { paymentId: 'B', amount: '20.00', paidAt },
      });
    });

    await waitFor(() => seen.length === 3);

    expect(seen).toEqual(['A', 'A', 'B']);
  });

  it('should not acknowledge a message without handler', async () => {
    const workOrderId = await createWorkOrder();

    const unhandledLines = () =>
      ctx
        .logCapture!.lines()
        .filter(
          (line) =>
            line['oficina.event.name'] === 'messaging.message.unhandled' &&
            line['oficina.work_order.id'] === workOrderId,
        );

    await addMessage({
      type: 'inventory.stock.reservation_failed',
      workOrderId,
      payload: { quoteId: randomUUID(), missing: [] },
    });

    await waitFor(() => unhandledLines().length >= 2);

    expect(unhandledLines()[0]).toMatchObject({ level: 'warn' });
  });

  it('should only emit declared fields on messaging lines', () => {
    const messagingLines = ctx
      .logCapture!.lines()
      .filter((line) => Object.keys(line).some((key) => key.startsWith('messaging.')));

    expect(messagingLines.length).toBeGreaterThan(0);
    expect(
      messagingLines
        .flatMap((line) => Object.keys(line))
        .filter((key) => !DECLARED_FIELD_NAMES.has(key)),
    ).toEqual([]);
  });
});
