import type { Server } from 'http';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import {
  DeleteMessageCommand,
  GetQueueUrlCommand,
  ReceiveMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import { MessageEnvelope } from '@application/messaging/message-envelope';
import { IUnitOfWork } from '@domain/interfaces/repositories/unit-of-work.interface';
import { TestContext, setupTestApp, teardownTestApp } from '../helpers/test-app.helper';
import { AuthTokens, registerAndLogin } from '../helpers/auth.helper';
import { readInternalQuoteFixture } from '../helpers/billing-quotes-gateway-mock.factory';
import {
  InternalServicesStub,
  startInternalServicesStub,
  stubPartSupply,
  stubService,
} from '../helpers/internal-services-stub';
import { waitFor } from '../helpers/wait-for.helper';

interface MailhogResponse {
  items: {
    To: { Mailbox: string; Domain: string }[];
    Content: { Headers: { Subject: string[] } };
  }[];
}

const CUSTOMER_EMAIL = 'saga@e2e.test';

// Every test runs on its own work order. The Billing events and the Inventory replies are written
// to this service's outbox, which the work order queue filter delivers back to it; the commands
// are read from the billing and inventory queues, which have no consumer here.
describe('Quote approval saga (E2E)', () => {
  let ctx: TestContext;
  let httpServer: Server;
  let adminAuth: AuthTokens;
  let stub: InternalServicesStub;
  let unitOfWork: IUnitOfWork;
  let sqs: SQSClient;
  let inventoryQueueUrl: string;
  let billingQueueUrl: string;
  let customerId: string;
  let vehicleId: string;

  beforeAll(async () => {
    stub = await startInternalServicesStub();
    ctx = await setupTestApp({ withMessaging: true, internalServicesUrl: stub.url });
    httpServer = ctx.httpServer;
    unitOfWork = ctx.app.get<IUnitOfWork>('IUnitOfWork');
    sqs = ctx.app.get(SQSClient);

    const inventoryQueue = await sqs.send(new GetQueueUrlCommand({ QueueName: 'inventory.fifo' }));
    const billingQueue = await sqs.send(new GetQueueUrlCommand({ QueueName: 'billing.fifo' }));

    inventoryQueueUrl = inventoryQueue.QueueUrl as string;
    billingQueueUrl = billingQueue.QueueUrl as string;

    adminAuth = await registerAndLogin(
      httpServer,
      { name: 'Admin Saga', email: 'admin-saga@e2e.test', role: 'ADMIN' },
      ctx.prisma,
    );

    const customer = await ctx.prisma.customer.create({
      data: {
        name: 'Cliente Saga',
        document: '52998224725',
        email: CUSTOMER_EMAIL,
        phone: '11999999999',
      },
    });

    const vehicle = await ctx.prisma.vehicle.create({
      data: { customerId: customer.id, plate: 'SAG1A23', brand: 'Fiat', model: 'Uno', year: 2020 },
    });

    customerId = customer.id;
    vehicleId = vehicle.id;
  });

  afterAll(async () => {
    await teardownTestApp(ctx);
    await stub.close();
  });

  async function createWorkOrderInDiagnosis(): Promise<{ id: string; number: string }> {
    const res = await request(httpServer)
      .post('/api/work-orders')
      .set('Authorization', `Bearer ${adminAuth.accessToken}`)
      .send({ customerId, vehicleId, problemDescription: 'Revisão geral' })
      .expect(201);

    await request(httpServer)
      .patch(`/api/work-orders/${res.body.data.id}`)
      .set('Authorization', `Bearer ${adminAuth.accessToken}`)
      .send({ status: 'IN_DIAGNOSIS' })
      .expect(200);

    return res.body.data as { id: string; number: string };
  }

  async function sendQuote(workOrderId: string): Promise<string> {
    const quoteId = randomUUID();

    await unitOfWork.executeTransaction((repositories) =>
      repositories.outbox.add({
        type: 'billing.quote.sent',
        workOrderId,
        payload: {
          quoteId,
          sentBy: adminAuth.user.id,
          total: '240.00',
          items: [
            { name: 'Troca de óleo', quantity: 1, unitPrice: '150.00' },
            { name: 'Filtro de óleo', quantity: 2, unitPrice: '45.00' },
          ],
        },
      }),
    );

    await waitFor(
      async () =>
        (await ctx.prisma.workOrder.findUniqueOrThrow({ where: { id: workOrderId } })).status ===
        'AWAITING_APPROVAL',
    );

    return quoteId;
  }

  function approveQuote(
    workOrderId: string,
    quoteId: string,
    serviceId: string,
    partSupplyId?: string,
  ): Promise<void> {
    return unitOfWork.executeTransaction((repositories) =>
      repositories.outbox.add({
        type: 'billing.quote.approved',
        workOrderId,
        payload: {
          quoteId,
          decidedBy: adminAuth.user.id,
          total: partSupplyId ? '240.00' : '150.00',
          services: [{ serviceId, quantity: 1, unitPrice: '150.00' }],
          partsSupplies: partSupplyId ? [{ partSupplyId, quantity: 2, unitPrice: '45.00' }] : [],
        },
      }),
    );
  }

  // Deletes every message it receives; one more short poll after the expected count catches extras.
  async function receiveCommands(
    queueUrl: string,
    workOrderId: string,
    expectedCount: number,
  ): Promise<MessageEnvelope[]> {
    const commands: MessageEnvelope[] = [];

    const receive = async (): Promise<void> => {
      const { Messages = [] } = await sqs.send(
        new ReceiveMessageCommand({
          QueueUrl: queueUrl,
          MaxNumberOfMessages: 10,
          WaitTimeSeconds: 1,
        }),
      );

      for (const message of Messages) {
        const envelope = JSON.parse(message.Body as string) as MessageEnvelope;

        if (envelope.workOrderId === workOrderId) commands.push(envelope);

        await sqs.send(
          new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: message.ReceiptHandle }),
        );
      }
    };

    await waitFor(async () => {
      await receive();
      return commands.length >= expectedCount;
    });

    await receive();

    return commands;
  }

  async function waitForEmail(workOrderNumber: string, subjectPart: string): Promise<void> {
    const mailhogUrl = `http://${ctx.mailhogContainer.getHost()}:${ctx.mailhogContainer.getMappedPort(8025)}`;

    await waitFor(async () => {
      const { items } = (await (
        await fetch(`${mailhogUrl}/api/v2/messages`)
      ).json()) as MailhogResponse;

      return items.some(
        (item) =>
          item.To.some((to) => `${to.Mailbox}@${to.Domain}` === CUSTOMER_EMAIL) &&
          item.Content.Headers.Subject[0].includes(workOrderNumber) &&
          item.Content.Headers.Subject[0].includes(subjectPart),
      );
    }, 10_000);
  }

  it('should approve the work order with the items of the approved quote when the Inventory confirms the reservation', async () => {
    const workOrder = await createWorkOrderInDiagnosis();
    const serviceId = stubService(stub, { basePrice: 150 }).id;
    const partSupplyId = stubPartSupply(stub, { salePrice: 45 }).id;
    const quoteId = await sendQuote(workOrder.id);
    const approvedQuote = readInternalQuoteFixture().data;

    // The approved quote the Billing answers on GET /internal/quotes/:id.
    stub.quotes.set(quoteId, {
      ...approvedQuote,
      id: quoteId,
      workOrderId: workOrder.id,
      decidedBy: adminAuth.user.id,
      services: [{ ...approvedQuote.services[0], id: serviceId, quantity: 1, unitPrice: 150 }],
      partsSupplies: [
        { ...approvedQuote.partsSupplies[0], id: partSupplyId, quantity: 2, unitPrice: 45 },
      ],
    });

    await approveQuote(workOrder.id, quoteId, serviceId, partSupplyId);

    const commands = await receiveCommands(inventoryQueueUrl, workOrder.id, 1);

    await unitOfWork.executeTransaction((repositories) =>
      repositories.outbox.add({
        type: 'inventory.stock.reserved',
        workOrderId: workOrder.id,
        payload: { quoteId },
      }),
    );

    await waitFor(
      async () =>
        (await ctx.prisma.sagaInstance.findFirst({ where: { correlationId: quoteId } }))?.status ===
        'COMPLETED',
    );

    const woRes = await request(httpServer)
      .get(`/api/work-orders/${workOrder.id}`)
      .set('Authorization', `Bearer ${adminAuth.accessToken}`)
      .expect(200);

    const history = await ctx.prisma.statusHistory.findFirstOrThrow({
      where: { workOrderId: workOrder.id, newStatus: 'APPROVED' },
    });

    expect(commands).toEqual([
      expect.objectContaining({
        type: 'inventory.stock.reserve',
        payload: { quoteId, items: [{ partSupplyId, quantity: 2 }] },
      }),
    ]);
    expect(woRes.body.data).toMatchObject({
      status: 'APPROVED',
      totalAmount: 240,
      services: [expect.objectContaining({ quantity: 1, unitPrice: 150 })],
      partSupplies: [expect.objectContaining({ id: partSupplyId, quantity: 2, unitPrice: 45 })],
    });
    expect(history).toMatchObject({
      previousStatus: 'AWAITING_APPROVAL',
      changedById: adminAuth.user.id,
    });
  });

  it('should approve a work order whose quote has no parts without a reservation', async () => {
    const workOrder = await createWorkOrderInDiagnosis();
    const serviceId = stubService(stub, { basePrice: 150 }).id;
    const quoteId = await sendQuote(workOrder.id);

    await approveQuote(workOrder.id, quoteId, serviceId);

    await waitFor(
      async () =>
        (await ctx.prisma.workOrder.findUniqueOrThrow({ where: { id: workOrder.id } })).status ===
        'APPROVED',
    );

    const saga = await ctx.prisma.sagaInstance.findFirstOrThrow({
      where: { correlationId: quoteId },
    });

    const commands = await receiveCommands(inventoryQueueUrl, workOrder.id, 0);

    expect(saga.status).toBe('COMPLETED');
    expect(commands).toEqual([]);
  });

  it('should compensate the approval when the Inventory refuses the reservation and reopen the saga on a new approval', async () => {
    const workOrder = await createWorkOrderInDiagnosis();
    const serviceId = stubService(stub, { basePrice: 150 }).id;
    const partSupplyId = stubPartSupply(stub, { salePrice: 45 }).id;
    const quoteId = await sendQuote(workOrder.id);

    await approveQuote(workOrder.id, quoteId, serviceId, partSupplyId);

    await receiveCommands(inventoryQueueUrl, workOrder.id, 1);

    await unitOfWork.executeTransaction((repositories) =>
      repositories.outbox.add({
        type: 'inventory.stock.reservation_failed',
        workOrderId: workOrder.id,
        payload: { quoteId, missing: [{ partSupplyId, requested: 2, available: 0 }] },
      }),
    );

    const revertCommands = await receiveCommands(billingQueueUrl, workOrder.id, 1);

    const compensatingSaga = await ctx.prisma.sagaInstance.findFirstOrThrow({
      where: { correlationId: quoteId },
    });

    await unitOfWork.executeTransaction((repositories) =>
      repositories.outbox.add({
        type: 'billing.quote.approval_reverted',
        workOrderId: workOrder.id,
        payload: { quoteId, revertTo: 'SENT' },
      }),
    );

    await waitFor(
      async () =>
        (await ctx.prisma.sagaInstance.findFirst({ where: { correlationId: quoteId } }))?.status ===
        'COMPENSATED',
    );

    const compensatedSaga = await ctx.prisma.sagaInstance.findFirstOrThrow({
      where: { correlationId: quoteId },
    });

    const history = await ctx.prisma.statusHistory.findMany({
      where: {
        workOrderId: workOrder.id,
        previousStatus: 'AWAITING_APPROVAL',
        newStatus: 'AWAITING_APPROVAL',
      },
    });

    const compensatedWorkOrder = await ctx.prisma.workOrder.findUniqueOrThrow({
      where: { id: workOrder.id },
    });

    expect(revertCommands).toEqual([
      expect.objectContaining({
        type: 'billing.quote.revert_approval',
        payload: { quoteId, revertTo: 'SENT' },
      }),
    ]);
    expect(compensatingSaga).toMatchObject({
      status: 'COMPENSATING',
      failureReason: 'INSUFFICIENT_STOCK',
    });
    expect(compensatedSaga).toMatchObject({
      status: 'COMPENSATED',
      failureReason: 'INSUFFICIENT_STOCK',
    });
    expect(history).toEqual([
      expect.objectContaining({
        notes: `Aprovação do orçamento ${quoteId} desfeita por falta de estoque`,
      }),
    ]);
    expect(compensatedWorkOrder.status).toBe('AWAITING_APPROVAL');

    await waitForEmail(workOrder.number, 'Estoque');

    await approveQuote(workOrder.id, quoteId, serviceId, partSupplyId);

    const reserveCommands = await receiveCommands(inventoryQueueUrl, workOrder.id, 1);

    const reopenedSaga = await ctx.prisma.sagaInstance.findFirstOrThrow({
      where: { correlationId: quoteId },
    });

    expect(reopenedSaga).toMatchObject({
      id: compensatedSaga.id,
      status: 'RESERVING_STOCK',
      failureReason: null,
    });
    expect(reserveCommands).toEqual([
      expect.objectContaining({
        type: 'inventory.stock.reserve',
        payload: { quoteId, items: [{ partSupplyId, quantity: 2 }] },
      }),
    ]);
  });

  it('should request the reversal to REJECTED when the work order was cancelled before the approval arrived', async () => {
    const workOrder = await createWorkOrderInDiagnosis();
    const serviceId = stubService(stub, { basePrice: 150 }).id;
    const quoteId = await sendQuote(workOrder.id);

    await request(httpServer)
      .patch(`/api/work-orders/${workOrder.id}`)
      .set('Authorization', `Bearer ${adminAuth.accessToken}`)
      .send({ status: 'CANCELLED', notes: 'Cancelado pelo cliente' })
      .expect(200);

    await approveQuote(workOrder.id, quoteId, serviceId);

    const commands = await receiveCommands(billingQueueUrl, workOrder.id, 1);

    const saga = await ctx.prisma.sagaInstance.findFirstOrThrow({
      where: { correlationId: quoteId },
    });

    const cancelledWorkOrder = await ctx.prisma.workOrder.findUniqueOrThrow({
      where: { id: workOrder.id },
    });

    expect(commands).toEqual([
      expect.objectContaining({
        type: 'billing.quote.revert_approval',
        payload: { quoteId, revertTo: 'REJECTED' },
      }),
    ]);
    expect(saga).toMatchObject({
      status: 'COMPENSATING',
      failureReason: 'WORK_ORDER_NOT_AWAITING',
    });
    expect(cancelledWorkOrder.status).toBe('CANCELLED');
  });

  it('should move the work order to AWAITING_APPROVAL and e-mail the quote when the Billing sends it', async () => {
    const workOrder = await createWorkOrderInDiagnosis();

    await sendQuote(workOrder.id);

    const history = await ctx.prisma.statusHistory.findFirstOrThrow({
      where: { workOrderId: workOrder.id, newStatus: 'AWAITING_APPROVAL' },
    });

    expect(history).toMatchObject({
      previousStatus: 'IN_DIAGNOSIS',
      changedById: adminAuth.user.id,
    });

    await waitForEmail(workOrder.number, 'Aguardando');
  });

  it('should reject the work order when no sent quote remains', async () => {
    const workOrder = await createWorkOrderInDiagnosis();
    const quoteId = await sendQuote(workOrder.id);

    await unitOfWork.executeTransaction((repositories) =>
      repositories.outbox.add({
        type: 'billing.quote.rejected',
        workOrderId: workOrder.id,
        payload: {
          quoteId,
          reason: 'Valor acima do esperado',
          remainingSentCount: 0,
          decidedBy: adminAuth.user.id,
        },
      }),
    );

    await waitFor(
      async () =>
        (await ctx.prisma.workOrder.findUniqueOrThrow({ where: { id: workOrder.id } })).status ===
        'REJECTED',
    );

    const history = await ctx.prisma.statusHistory.findFirstOrThrow({
      where: { workOrderId: workOrder.id, newStatus: 'REJECTED' },
    });

    expect(history).toMatchObject({
      previousStatus: 'AWAITING_APPROVAL',
      changedById: adminAuth.user.id,
      notes: 'Valor acima do esperado',
    });
  });
});
