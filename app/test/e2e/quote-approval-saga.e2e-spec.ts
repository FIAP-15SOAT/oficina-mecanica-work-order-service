import type { Server } from 'http';
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

// Every test runs on its own work order: the Inventory is simulated by writing its replies to the
// work order outbox, and its commands are read from the inventory queue, which has no consumer here.
describe('Quote approval saga (E2E)', () => {
  let ctx: TestContext;
  let httpServer: Server;
  let adminAuth: AuthTokens;
  let stub: InternalServicesStub;
  let unitOfWork: IUnitOfWork;
  let sqs: SQSClient;
  let inventoryQueueUrl: string;
  let customerId: string;
  let vehicleId: string;

  beforeAll(async () => {
    stub = await startInternalServicesStub();
    ctx = await setupTestApp({ withMessaging: true, internalServicesUrl: stub.url });
    httpServer = ctx.httpServer;
    unitOfWork = ctx.app.get<IUnitOfWork>('IUnitOfWork');
    sqs = ctx.app.get(SQSClient);

    const { QueueUrl } = await sqs.send(new GetQueueUrlCommand({ QueueName: 'inventory.fifo' }));
    inventoryQueueUrl = QueueUrl as string;

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

  async function createSentQuote(workOrderId: string, partSupplyId?: string): Promise<string> {
    const createRes = await request(httpServer)
      .post('/api/quotes')
      .set('Authorization', `Bearer ${adminAuth.accessToken}`)
      .send({ workOrderId })
      .expect(201);

    const quoteId = createRes.body.data.id as string;

    await request(httpServer)
      .post(`/api/quotes/${quoteId}/services`)
      .set('Authorization', `Bearer ${adminAuth.accessToken}`)
      .send({ serviceId: stubService(stub, { basePrice: 150 }).id, quantity: 1 })
      .expect(200);

    if (partSupplyId) {
      await request(httpServer)
        .post(`/api/quotes/${quoteId}/parts-supplies`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ partSupplyId, quantity: 2 })
        .expect(200);
    }

    await request(httpServer)
      .post(`/api/quotes/${quoteId}/submissions`)
      .set('Authorization', `Bearer ${adminAuth.accessToken}`)
      .expect(200);

    return quoteId;
  }

  // Deletes every message it receives; one more short poll after the expected count catches extras.
  async function receiveInventoryCommands(
    workOrderId: string,
    expectedCount: number,
  ): Promise<MessageEnvelope[]> {
    const commands: MessageEnvelope[] = [];

    const receive = async (waitTimeSeconds: number): Promise<void> => {
      const { Messages = [] } = await sqs.send(
        new ReceiveMessageCommand({
          QueueUrl: inventoryQueueUrl,
          MaxNumberOfMessages: 10,
          WaitTimeSeconds: waitTimeSeconds,
        }),
      );

      for (const message of Messages) {
        const envelope = JSON.parse(message.Body as string) as MessageEnvelope;

        if (envelope.workOrderId === workOrderId) commands.push(envelope);

        await sqs.send(
          new DeleteMessageCommand({
            QueueUrl: inventoryQueueUrl,
            ReceiptHandle: message.ReceiptHandle,
          }),
        );
      }
    };

    await waitFor(async () => {
      await receive(1);
      return commands.length >= expectedCount;
    });

    await receive(1);

    return commands;
  }

  async function approveAndRefuseStock(): Promise<{
    workOrder: { id: string; number: string };
    quoteId: string;
    siblingQuoteId: string;
    partSupplyId: string;
  }> {
    const workOrder = await createWorkOrderInDiagnosis();

    const partSupply = stubPartSupply(stub, { salePrice: 45 });

    const quoteId = await createSentQuote(workOrder.id, partSupply.id);

    const siblingQuoteId = await createSentQuote(workOrder.id);

    await request(httpServer)
      .patch(`/api/quotes/${quoteId}`)
      .set('Authorization', `Bearer ${adminAuth.accessToken}`)
      .send({ status: 'APPROVED' })
      .expect(200);

    await receiveInventoryCommands(workOrder.id, 1);

    await unitOfWork.executeTransaction((repositories) =>
      repositories.outbox.add({
        type: 'inventory.stock.reservation_failed',
        workOrderId: workOrder.id,
        payload: {
          quoteId,
          missing: [{ partSupplyId: partSupply.id, requested: 2, available: 0 }],
        },
      }),
    );

    await waitFor(
      async () =>
        (await ctx.prisma.sagaInstance.findFirstOrThrow({ where: { correlationId: quoteId } }))
          .status === 'COMPENSATED',
    );

    return { workOrder, quoteId, siblingQuoteId, partSupplyId: partSupply.id };
  }

  it('should compensate the approval when the Inventory refuses the reservation', async () => {
    const { workOrder, quoteId, siblingQuoteId } = await approveAndRefuseStock();

    const quotes = await ctx.prisma.quote.findMany({ where: { workOrderId: workOrder.id } });

    const woRes = await request(httpServer)
      .get(`/api/work-orders/${workOrder.id}`)
      .set('Authorization', `Bearer ${adminAuth.accessToken}`)
      .expect(200);

    const history = await ctx.prisma.statusHistory.findMany({
      where: {
        workOrderId: workOrder.id,
        previousStatus: 'AWAITING_APPROVAL',
        newStatus: 'AWAITING_APPROVAL',
      },
    });

    const saga = await ctx.prisma.sagaInstance.findFirstOrThrow({
      where: { correlationId: quoteId },
    });

    expect(quotes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: quoteId, status: 'SENT', replacedByQuoteId: null }),
        expect.objectContaining({ id: siblingQuoteId, status: 'SENT', replacedByQuoteId: null }),
      ]),
    );
    expect(woRes.body.data.status).toBe('AWAITING_APPROVAL');
    expect(woRes.body.data.partSupplies).toEqual([]);
    expect(saga).toMatchObject({
      status: 'COMPENSATED',
      failureReason: 'INSUFFICIENT_STOCK',
    });
    expect(history).toEqual([
      expect.objectContaining({
        notes: `Aprovação do orçamento ${quoteId} desfeita por falta de estoque`,
      }),
    ]);

    await waitFor(async () => {
      const mailhogUrl = `http://${ctx.mailhogContainer.getHost()}:${ctx.mailhogContainer.getMappedPort(8025)}`;
      const { items } = (await (
        await fetch(`${mailhogUrl}/api/v2/messages`)
      ).json()) as MailhogResponse;

      return items.some(
        (item) =>
          item.To.some((to) => `${to.Mailbox}@${to.Domain}` === CUSTOMER_EMAIL) &&
          item.Content.Headers.Subject[0].includes(workOrder.number),
      );
    }, 10_000);
  });

  it('should reopen the same saga and send a new reserve command when the quote is approved again', async () => {
    const { workOrder, quoteId, partSupplyId } = await approveAndRefuseStock();

    const compensatedSaga = await ctx.prisma.sagaInstance.findFirstOrThrow({
      where: { correlationId: quoteId },
    });

    await request(httpServer)
      .patch(`/api/quotes/${quoteId}`)
      .set('Authorization', `Bearer ${adminAuth.accessToken}`)
      .send({ status: 'APPROVED' })
      .expect(200);

    const commands = await receiveInventoryCommands(workOrder.id, 1);

    const reopenedSaga = await ctx.prisma.sagaInstance.findFirstOrThrow({
      where: { correlationId: quoteId },
    });

    expect(reopenedSaga).toMatchObject({
      id: compensatedSaga.id,
      status: 'RESERVING_STOCK',
      failureReason: null,
    });
    expect(commands).toEqual([
      expect.objectContaining({
        type: 'inventory.stock.reserve',
        payload: { quoteId, items: [{ partSupplyId, quantity: 2 }] },
      }),
    ]);
  });

  it('should approve the work order when the Inventory confirms the reservation', async () => {
    const workOrder = await createWorkOrderInDiagnosis();

    const partSupply = stubPartSupply(stub, { salePrice: 45 });

    const quoteId = await createSentQuote(workOrder.id, partSupply.id);

    await request(httpServer)
      .patch(`/api/quotes/${quoteId}`)
      .set('Authorization', `Bearer ${adminAuth.accessToken}`)
      .send({ status: 'APPROVED' })
      .expect(200);

    await receiveInventoryCommands(workOrder.id, 1);

    await unitOfWork.executeTransaction((repositories) =>
      repositories.outbox.add({
        type: 'inventory.stock.reserved',
        workOrderId: workOrder.id,
        payload: { quoteId },
      }),
    );

    await waitFor(
      async () =>
        (await ctx.prisma.sagaInstance.findFirstOrThrow({ where: { correlationId: quoteId } }))
          .status === 'COMPLETED',
    );

    const woRes = await request(httpServer)
      .get(`/api/work-orders/${workOrder.id}`)
      .set('Authorization', `Bearer ${adminAuth.accessToken}`)
      .expect(200);

    const history = await ctx.prisma.statusHistory.findFirstOrThrow({
      where: { workOrderId: workOrder.id, newStatus: 'APPROVED' },
    });

    expect(woRes.body.data).toMatchObject({
      status: 'APPROVED',
      totalAmount: 240,
      services: [expect.objectContaining({ quantity: 1, unitPrice: 150 })],
      partSupplies: [expect.objectContaining({ id: partSupply.id, quantity: 2, unitPrice: 45 })],
    });

    expect(history).toMatchObject({
      previousStatus: 'AWAITING_APPROVAL',
      changedById: adminAuth.user.id,
    });
  });

  it('should let only one of two concurrent approvals of the same work order through', async () => {
    const workOrder = await createWorkOrderInDiagnosis();

    const firstQuoteId = await createSentQuote(
      workOrder.id,
      stubPartSupply(stub, { salePrice: 45 }).id,
    );

    const secondQuoteId = await createSentQuote(
      workOrder.id,
      stubPartSupply(stub, { salePrice: 45 }).id,
    );

    const responses = await Promise.all([
      request(httpServer)
        .patch(`/api/quotes/${firstQuoteId}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ status: 'APPROVED' }),
      request(httpServer)
        .patch(`/api/quotes/${secondQuoteId}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ status: 'APPROVED' }),
    ]);

    const sagaCount = await ctx.prisma.sagaInstance.count({
      where: { workOrderId: workOrder.id },
    });

    const commands = await receiveInventoryCommands(workOrder.id, 1);

    expect(responses.map((res) => res.status).sort()).toEqual([200, 409]);
    expect(sagaCount).toBe(1);
    expect(commands).toHaveLength(1);
  });
});
