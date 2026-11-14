import type { Server } from 'http';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { GetQueueUrlCommand, SQSClient } from '@aws-sdk/client-sqs';
import { IUnitOfWork } from '@domain/interfaces/repositories/unit-of-work.interface';
import { TestContext, setupTestApp, teardownTestApp } from '../helpers/test-app.helper';
import {
  InternalServicesStub,
  startInternalServicesStub,
  stubIdentityUser,
} from '../helpers/internal-services-stub';
import { StaffUser, createStaffUser } from '../helpers/auth.helper';
import { receiveCommands } from '../helpers/sqs-commands.helper';
import { waitFor } from '../helpers/wait-for.helper';

const CUSTOMER_EMAIL = 'payment-saga@e2e.test';
const LINKED_USER_EMAIL = 'acesso.pagamento@e2e.test';
const APPROVED_AT = new Date('2026-11-10T12:00:00.000Z');
const FINISHED_AT = new Date('2026-11-11T12:00:00.000Z');

const checkoutUrl = (paymentId: string): string =>
  `https://pagamento.e2e.test/checkout/${paymentId}`;

// Every test runs on its own work order. The Billing events are written to this service's outbox,
// which the work order queue filter delivers back to it; the commands and the e-mails are read from
// the billing and notification queues, which have no consumer here.
describe('Payment saga (E2E)', () => {
  let stub: InternalServicesStub;
  let ctx: TestContext;
  let httpServer: Server;
  let adminAuth: StaffUser;
  let unitOfWork: IUnitOfWork;
  let sqs: SQSClient;
  let billingQueueUrl: string;
  let notificationQueueUrl: string;
  let customerId: string;
  let vehicleId: string;

  beforeAll(async () => {
    stub = await startInternalServicesStub();
    ctx = await setupTestApp({ withMessaging: true, internalServicesUrl: stub.url });
    httpServer = ctx.httpServer;
    unitOfWork = ctx.app.get<IUnitOfWork>('IUnitOfWork');
    sqs = ctx.app.get(SQSClient);

    const billingQueue = await sqs.send(new GetQueueUrlCommand({ QueueName: 'billing.fifo' }));
    const notificationQueue = await sqs.send(
      new GetQueueUrlCommand({ QueueName: 'notification.fifo' }),
    );

    billingQueueUrl = billingQueue.QueueUrl as string;
    notificationQueueUrl = notificationQueue.QueueUrl as string;

    adminAuth = createStaffUser({ stub }, { name: 'Admin Pagamento' });

    const customer = await ctx.prisma.customer.create({
      data: {
        name: 'Cliente Pagamento',
        document: '52998224725',
        email: CUSTOMER_EMAIL,
        phone: '11999999999',
      },
    });

    const vehicle = await ctx.prisma.vehicle.create({
      data: { customerId: customer.id, plate: 'PAG1A23', brand: 'Fiat', model: 'Uno', year: 2020 },
    });

    // The linked user served by the Identity is who the payment e-mail goes to.
    const linkedUser = stubIdentityUser(stub, {
      name: 'Acesso Pagamento',
      email: LINKED_USER_EMAIL,
      role: null,
    });

    await ctx.prisma.userCustomer.create({
      data: { userId: linkedUser.id, customerId: customer.id },
    });

    customerId = customer.id;
    vehicleId = vehicle.id;
  });

  afterAll(async () => {
    await teardownTestApp(ctx);
    await stub.close();
  });

  // The approval and the execution are covered by their own suites; the payment only needs the
  // status it starts from.
  async function createWorkOrder(
    status: 'APPROVED' | 'COMPLETED' | 'IN_PROGRESS',
  ): Promise<{ id: string; number: string }> {
    const res = await request(httpServer)
      .post('/api/work-orders')
      .set('Authorization', adminAuth.authorization)
      .send({ customerId, vehicleId, problemDescription: 'Revisão geral' })
      .expect(201);

    await ctx.prisma.workOrder.update({
      where: { id: res.body.data.id },
      data: {
        status,
        approvedAt: APPROVED_AT,
        finishedAt: status === 'COMPLETED' ? FINISHED_AT : null,
      },
    });

    return res.body.data as { id: string; number: string };
  }

  async function requestPayment(workOrderId: string): Promise<string> {
    const paymentId = randomUUID();

    await unitOfWork.executeTransaction((repositories) =>
      repositories.outbox.add({
        type: 'billing.payment.requested',
        workOrderId,
        payload: {
          paymentId,
          amount: '240.00',
          checkoutUrl: checkoutUrl(paymentId),
          expiresAt: '2026-11-20T15:00:00.000Z',
        },
      }),
    );

    await waitFor(
      async () =>
        (await ctx.prisma.sagaInstance.findFirst({ where: { correlationId: paymentId } })) !== null,
    );

    return paymentId;
  }

  async function sendPaymentResult(
    workOrderId: string,
    paymentId: string,
    reason?: 'EXPIRED' | 'CANCELLED',
  ): Promise<void> {
    await unitOfWork.executeTransaction((repositories) =>
      repositories.outbox.add(
        reason
          ? { type: 'billing.payment.failed', workOrderId, payload: { paymentId, reason } }
          : {
              type: 'billing.payment.approved',
              workOrderId,
              payload: { paymentId, amount: '240.00', paidAt: '2026-11-13T15:00:00.000Z' },
            },
      ),
    );
  }

  function waitForSagaStatus(paymentId: string, status: string): Promise<void> {
    return waitFor(
      async () =>
        (await ctx.prisma.sagaInstance.findFirst({ where: { correlationId: paymentId } }))
          ?.status === status,
    );
  }

  it('should hold an approved work order and release it to APPROVED when the payment is approved', async () => {
    const workOrder = await createWorkOrder('APPROVED');
    const paymentId = await requestPayment(workOrder.id);

    const heldSaga = await ctx.prisma.sagaInstance.findFirstOrThrow({
      where: { correlationId: paymentId },
    });

    const heldWorkOrder = await ctx.prisma.workOrder.findUniqueOrThrow({
      where: { id: workOrder.id },
    });

    expect(heldSaga).toMatchObject({
      type: 'PAYMENT',
      workOrderId: workOrder.id,
      status: 'AWAITING_PAYMENT',
      originStatus: 'APPROVED',
    });

    expect(heldWorkOrder.status).toBe('AWAITING_PAYMENT');

    const emails = await receiveCommands(sqs, notificationQueueUrl, workOrder.id, 1);

    expect(emails).toEqual([
      expect.objectContaining({
        type: 'notification.email.send',
        payload: expect.objectContaining({
          to: [LINKED_USER_EMAIL],
          purpose: 'payment_link',
          text: expect.stringContaining(checkoutUrl(paymentId)),
        }),
      }),
    ]);

    await sendPaymentResult(workOrder.id, paymentId);

    await waitForSagaStatus(paymentId, 'COMPLETED');

    const woRes = await request(httpServer)
      .get(`/api/work-orders/${workOrder.id}`)
      .set('Authorization', adminAuth.authorization)
      .expect(200);

    const releasedWorkOrder = await ctx.prisma.workOrder.findUniqueOrThrow({
      where: { id: workOrder.id },
    });

    const history = await ctx.prisma.statusHistory.findMany({
      where: { workOrderId: workOrder.id },
      orderBy: { createdAt: 'asc' },
    });

    expect(woRes.body.data.status).toBe('APPROVED');
    expect(releasedWorkOrder.approvedAt).toEqual(APPROVED_AT);

    expect(history.slice(-2)).toEqual([
      expect.objectContaining({
        previousStatus: 'APPROVED',
        newStatus: 'AWAITING_PAYMENT',
        changedById: null,
        notes: `Aguardando o pagamento da cobrança ${paymentId}`,
      }),
      expect.objectContaining({
        previousStatus: 'AWAITING_PAYMENT',
        newStatus: 'APPROVED',
        changedById: null,
        notes: `Cobrança ${paymentId} paga`,
      }),
    ]);
  });

  it('should release a completed work order back to COMPLETED and then deliver it', async () => {
    const workOrder = await createWorkOrder('COMPLETED');
    const paymentId = await requestPayment(workOrder.id);

    const heldSaga = await ctx.prisma.sagaInstance.findFirstOrThrow({
      where: { correlationId: paymentId },
    });

    expect(heldSaga).toMatchObject({ status: 'AWAITING_PAYMENT', originStatus: 'COMPLETED' });

    await sendPaymentResult(workOrder.id, paymentId);

    await waitForSagaStatus(paymentId, 'COMPLETED');

    const releasedWorkOrder = await ctx.prisma.workOrder.findUniqueOrThrow({
      where: { id: workOrder.id },
    });

    expect(releasedWorkOrder).toMatchObject({ status: 'COMPLETED', finishedAt: FINISHED_AT });

    const deliveryRes = await request(httpServer)
      .patch(`/api/work-orders/${workOrder.id}`)
      .set('Authorization', adminAuth.authorization)
      .send({ status: 'DELIVERED' })
      .expect(200);

    expect(deliveryRes.body.data.status).toBe('DELIVERED');
  });

  it('should return the work order to its origin and compensate the saga when the payment expires', async () => {
    const workOrder = await createWorkOrder('APPROVED');
    const paymentId = await requestPayment(workOrder.id);

    await sendPaymentResult(workOrder.id, paymentId, 'EXPIRED');

    await waitForSagaStatus(paymentId, 'COMPENSATED');

    const saga = await ctx.prisma.sagaInstance.findFirstOrThrow({
      where: { correlationId: paymentId },
    });

    const releasedWorkOrder = await ctx.prisma.workOrder.findUniqueOrThrow({
      where: { id: workOrder.id },
    });

    const history = await ctx.prisma.statusHistory.findFirstOrThrow({
      where: { workOrderId: workOrder.id, previousStatus: 'AWAITING_PAYMENT' },
    });

    expect(saga.failureReason).toBe('PAYMENT_EXPIRED');
    expect(releasedWorkOrder.status).toBe('APPROVED');

    expect(history).toMatchObject({
      newStatus: 'APPROVED',
      notes: `Cobrança ${paymentId} expirada`,
    });
  });

  it('should ask the Billing to cancel the payment when the work order is already in progress', async () => {
    const workOrder = await createWorkOrder('IN_PROGRESS');
    const paymentId = await requestPayment(workOrder.id);

    const commands = await receiveCommands(sqs, billingQueueUrl, workOrder.id, 1);

    const compensatingSaga = await ctx.prisma.sagaInstance.findFirstOrThrow({
      where: { correlationId: paymentId },
    });

    expect(commands).toEqual([
      expect.objectContaining({
        type: 'billing.payment.cancel',
        payload: { paymentId, reason: 'WORK_ORDER_NOT_PAYABLE' },
      }),
    ]);

    expect(compensatingSaga).toMatchObject({
      status: 'COMPENSATING',
      failureReason: 'WORK_ORDER_NOT_PAYABLE',
    });

    await sendPaymentResult(workOrder.id, paymentId, 'CANCELLED');

    await waitForSagaStatus(paymentId, 'COMPENSATED');

    const compensatedSaga = await ctx.prisma.sagaInstance.findFirstOrThrow({
      where: { correlationId: paymentId },
    });

    const unchangedWorkOrder = await ctx.prisma.workOrder.findUniqueOrThrow({
      where: { id: workOrder.id },
    });

    const history = await ctx.prisma.statusHistory.findMany({
      where: { workOrderId: workOrder.id },
    });

    expect(compensatedSaga.failureReason).toBe('WORK_ORDER_NOT_PAYABLE');
    expect(unchangedWorkOrder.status).toBe('IN_PROGRESS');
    expect(history.map(({ newStatus }) => newStatus)).toEqual(['RECEIVED']);
    expect(await receiveCommands(sqs, notificationQueueUrl, workOrder.id, 0)).toEqual([]);
  });
});
