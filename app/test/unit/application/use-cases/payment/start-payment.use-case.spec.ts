import { randomUUID } from 'node:crypto';

import { Customer } from '@domain/entities/customer.entity';
import { WorkOrder } from '@domain/entities/work-order.entity';
import { SagaFailureReason } from '@domain/enums/saga-failure-reason.enum';
import { SagaStatus } from '@domain/enums/saga-status.enum';
import { SagaType } from '@domain/enums/saga-type.enum';
import { WorkOrderStatus } from '@domain/enums/work-order-status.enum';
import { IRepositories, IUnitOfWork } from '@domain/interfaces/repositories/unit-of-work.interface';
import { Email } from '@domain/value-objects/email.vo';

import { workOrderCacheKey } from '@application/keys/work-order-cache-key';
import { BUSINESS_EVENTS } from '@application/logging/business-event.catalog';
import { BUSINESS_METRICS } from '@application/metrics/business-metric.catalog';
import { StartPaymentInputDto } from '@application/ports/input/payment/dto/start-payment.dto';
import { ICache } from '@application/ports/output/services/cache.service.interface';
import { IIdentityUsersGateway } from '@application/ports/output/gateways/identity/identity-users-gateway.interface';
import { IEmailSenderService } from '@application/ports/output/services/email-sender.service.interface';
import { ILogger } from '@application/ports/output/services/logger.service.interface';
import { IMetrics } from '@application/ports/output/services/metrics.service.interface';
import { StartPaymentUseCase } from '@application/use-cases/payment/start-payment.use-case';

import { createMockCache } from '../../../../helpers/cache-mock.factory';
import { createMockCustomer } from '../../../../helpers/customer-mock.factory';
import { createMockLogger } from '../../../../helpers/logger-mock.factory';
import { createMockMetrics } from '../../../../helpers/metrics-mock.factory';
import { createMockSagaInstance } from '../../../../helpers/saga-instance-mock.factory';
import {
  arrangeStatusHistory,
  createMockStatusHistory,
} from '../../../../helpers/status-history-mock.factory';
import {
  createMockIdentityUserGatewayResponse,
  createMockIdentityUsersGateway,
} from '../../../../helpers/identity-users-gateway-mock.factory';
import { createMockUnitOfWorkWithRepos } from '../../../../helpers/unit-of-work-mock.factory';
import { createMockWorkOrder } from '../../../../helpers/work-order-mock.factory';

describe('StartPaymentUseCase', () => {
  let useCase: StartPaymentUseCase;
  let unitOfWork: jest.Mocked<IUnitOfWork>;
  let repos: jest.Mocked<IRepositories>;
  let emailSender: jest.Mocked<IEmailSenderService>;
  let logger: jest.Mocked<ILogger>;
  let metrics: jest.Mocked<IMetrics>;
  let cache: jest.Mocked<ICache>;
  let identityUsersGateway: jest.Mocked<IIdentityUsersGateway>;
  let customer: Customer;
  let workOrder: WorkOrder;
  let input: StartPaymentInputDto;

  beforeEach(() => {
    ({ unitOfWork, repos } = createMockUnitOfWorkWithRepos());

    emailSender = { send: jest.fn().mockResolvedValue(undefined) };

    logger = createMockLogger();

    metrics = createMockMetrics();

    cache = createMockCache();

    identityUsersGateway = createMockIdentityUsersGateway();

    customer = createMockCustomer({
      name: 'Maria Souza',
      email: Email.create('maria@example.com'),
    });

    workOrder = createMockWorkOrder({ customerId: customer.id, status: WorkOrderStatus.APPROVED });

    input = {
      paymentId: randomUUID(),
      workOrderId: workOrder.id,
      amount: '350.00',
      checkoutUrl: 'https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=123',
      expiresAt: '2026-11-15T15:00:00.000Z',
    };

    jest.mocked(repos.workOrder.findById).mockResolvedValue(workOrder);

    jest.mocked(repos.customer.findById).mockResolvedValue(customer);

    jest.mocked(repos.userCustomer.findUserIdsByCustomerId).mockResolvedValue([]);

    identityUsersGateway.findByIds.mockResolvedValue([]);

    useCase = new StartPaymentUseCase(
      unitOfWork,
      emailSender,
      logger,
      metrics,
      repos.statusHistory,
      cache,
      identityUsersGateway,
    );
  });

  it('should hold an approved work order, start the payment saga with its origin and e-mail the link to each recipient', async () => {
    const linkedUsers = [
      createMockIdentityUserGatewayResponse({ name: 'João Lima', email: 'joao@example.com' }),
      createMockIdentityUserGatewayResponse({ name: 'Ana Reis', email: 'ana@example.com' }),
    ];

    jest
      .mocked(repos.userCustomer.findUserIdsByCustomerId)
      .mockResolvedValue(linkedUsers.map((user) => user.id));
    identityUsersGateway.findByIds.mockResolvedValue(linkedUsers);

    arrangeStatusHistory(
      repos.statusHistory,
      [
        createMockStatusHistory({
          workOrderId: workOrder.id,
          previousStatus: WorkOrderStatus.AWAITING_APPROVAL,
          newStatus: WorkOrderStatus.APPROVED,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
        }),
      ],
      new Date('2026-01-01T02:00:00.000Z'),
    );

    await useCase.execute(input);

    expect(repos.sagaInstance.findByTypeAndCorrelationId).toHaveBeenCalledWith(
      SagaType.PAYMENT,
      input.paymentId,
    );

    expect(workOrder.status).toBe(WorkOrderStatus.AWAITING_PAYMENT);
    expect(repos.workOrder.update).toHaveBeenCalledWith(workOrder);

    expect(repos.sagaInstance.create).toHaveBeenCalledWith(
      expect.objectContaining({
        type: SagaType.PAYMENT,
        correlationId: input.paymentId,
        workOrderId: workOrder.id,
        status: SagaStatus.AWAITING_PAYMENT,
        failureReason: null,
        originStatus: WorkOrderStatus.APPROVED,
      }),
    );

    expect(repos.statusHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        workOrderId: workOrder.id,
        changedById: null,
        previousStatus: WorkOrderStatus.APPROVED,
        newStatus: WorkOrderStatus.AWAITING_PAYMENT,
        notes: `Aguardando o pagamento da cobrança ${input.paymentId}`,
      }),
    );

    expect(repos.outbox.add).not.toHaveBeenCalled();
    expect(repos.customer.findById).toHaveBeenCalledWith(customer.id);
    expect(repos.userCustomer.findUserIdsByCustomerId).toHaveBeenCalledWith(customer.id);
    expect(identityUsersGateway.findByIds).toHaveBeenCalledWith(linkedUsers.map((user) => user.id));
    expect(emailSender.send).toHaveBeenCalledTimes(2);

    const [email] = emailSender.send.mock.calls[0];

    expect(email).toEqual(
      expect.objectContaining({
        toEmail: 'joao@example.com',
        toName: 'João Lima',
        subject: `Pagamento da Ordem de Serviço ${workOrder.number.toString()}`,
      }),
    );

    expect(email.message.text).toContain(
      `Valor: R$ 350.00\nLink para pagamento: ${input.checkoutUrl}\nVálido até 15/11/2026, 12:00`,
    );

    expect(email.message.html).toContain(`<a href="${input.checkoutUrl}">`);

    expect(emailSender.send).toHaveBeenCalledWith(
      expect.objectContaining({ toEmail: 'ana@example.com', toName: 'Ana Reis' }),
    );

    expect(logger.event).toHaveBeenCalledTimes(1);
    expect(logger.event).toHaveBeenCalledWith(BUSINESS_EVENTS.SAGA_STARTED, {
      sagaId: expect.any(String),
      sagaType: SagaType.PAYMENT,
      sagaStatus: SagaStatus.AWAITING_PAYMENT,
      paymentId: input.paymentId,
      workOrderId: workOrder.id,
      workOrderNumber: workOrder.number.toString(),
    });

    expect(metrics.increment).toHaveBeenCalledWith(BUSINESS_METRICS.SAGA_STARTED, {
      sagaType: SagaType.PAYMENT,
    });
    expect(metrics.record).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'work_order.status.duration' }),
      2 * 3600,
      { workOrderStatus: WorkOrderStatus.APPROVED },
    );
  });

  it('should hold a completed work order with COMPLETED as origin', async () => {
    const completedWorkOrder = createMockWorkOrder({
      customerId: customer.id,
      status: WorkOrderStatus.COMPLETED,
    });

    jest.mocked(repos.workOrder.findById).mockResolvedValue(completedWorkOrder);

    await useCase.execute({ ...input, workOrderId: completedWorkOrder.id });

    expect(completedWorkOrder.status).toBe(WorkOrderStatus.AWAITING_PAYMENT);

    expect(repos.sagaInstance.create).toHaveBeenCalledWith(
      expect.objectContaining({
        status: SagaStatus.AWAITING_PAYMENT,
        originStatus: WorkOrderStatus.COMPLETED,
      }),
    );

    expect(repos.statusHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        previousStatus: WorkOrderStatus.COMPLETED,
        newStatus: WorkOrderStatus.AWAITING_PAYMENT,
      }),
    );
  });

  it('should start the saga compensating and ask the Billing to cancel the payment when the work order is not payable', async () => {
    const startedWorkOrder = createMockWorkOrder({
      customerId: customer.id,
      status: WorkOrderStatus.IN_PROGRESS,
    });

    jest.mocked(repos.workOrder.findById).mockResolvedValue(startedWorkOrder);

    await useCase.execute({ ...input, workOrderId: startedWorkOrder.id });

    expect(startedWorkOrder.status).toBe(WorkOrderStatus.IN_PROGRESS);
    expect(repos.workOrder.update).toHaveBeenCalledWith(startedWorkOrder);

    expect(repos.sagaInstance.create).toHaveBeenCalledWith(
      expect.objectContaining({
        type: SagaType.PAYMENT,
        correlationId: input.paymentId,
        workOrderId: startedWorkOrder.id,
        status: SagaStatus.COMPENSATING,
        failureReason: SagaFailureReason.WORK_ORDER_NOT_PAYABLE,
        originStatus: null,
      }),
    );

    expect(repos.outbox.add).toHaveBeenCalledWith({
      type: 'billing.payment.cancel',
      workOrderId: startedWorkOrder.id,
      payload: { paymentId: input.paymentId, reason: 'WORK_ORDER_NOT_PAYABLE' },
    });

    expect(jest.mocked(repos.workOrder.update).mock.invocationCallOrder[0]).toBeLessThan(
      jest.mocked(repos.outbox.add).mock.invocationCallOrder[0],
    );

    expect(repos.statusHistory.create).not.toHaveBeenCalled();
    expect(repos.customer.findById).not.toHaveBeenCalled();
    expect(emailSender.send).not.toHaveBeenCalled();
    expect(cache.delete).not.toHaveBeenCalled();
    expect(metrics.record).not.toHaveBeenCalled();

    expect(logger.event).toHaveBeenNthCalledWith(
      1,
      BUSINESS_EVENTS.SAGA_STARTED,
      expect.objectContaining({ paymentId: input.paymentId }),
    );

    expect(logger.event).toHaveBeenNthCalledWith(2, BUSINESS_EVENTS.SAGA_COMPENSATION_STARTED, {
      sagaId: expect.any(String),
      sagaType: SagaType.PAYMENT,
      sagaStatus: SagaStatus.COMPENSATING,
      paymentId: input.paymentId,
      workOrderId: startedWorkOrder.id,
      workOrderNumber: startedWorkOrder.number.toString(),
      sagaFailureReason: SagaFailureReason.WORK_ORDER_NOT_PAYABLE,
    });
  });

  // The work order stays APPROVED, so a settled saga must not let a redelivery hold it again.
  it.each([
    SagaStatus.AWAITING_PAYMENT,
    SagaStatus.COMPENSATING,
    SagaStatus.COMPLETED,
    SagaStatus.COMPENSATED,
  ])('should skip a redelivered payment request whose saga is %s', async (sagaStatus) => {
    jest.mocked(repos.sagaInstance.findByTypeAndCorrelationId).mockResolvedValue(
      createMockSagaInstance({
        type: SagaType.PAYMENT,
        correlationId: input.paymentId,
        status: sagaStatus,
        originStatus: WorkOrderStatus.APPROVED,
      }),
    );

    await useCase.execute(input);

    expect(workOrder.status).toBe(WorkOrderStatus.APPROVED);
    expect(repos.workOrder.update).not.toHaveBeenCalled();
    expect(repos.sagaInstance.create).not.toHaveBeenCalled();
    expect(repos.statusHistory.create).not.toHaveBeenCalled();
    expect(repos.outbox.add).not.toHaveBeenCalled();
    expect(emailSender.send).not.toHaveBeenCalled();
    expect(cache.delete).not.toHaveBeenCalled();

    expect(logger.event).toHaveBeenCalledWith(BUSINESS_EVENTS.SAGA_STEP_SKIPPED, {
      sagaType: SagaType.PAYMENT,
      paymentId: input.paymentId,
      sagaStatus,
    });
  });

  it('should keep the hold when an e-mail fails', async () => {
    const linkedUsers = [
      createMockIdentityUserGatewayResponse({ email: 'first@example.com' }),
      createMockIdentityUserGatewayResponse({ email: 'second@example.com' }),
    ];

    jest
      .mocked(repos.userCustomer.findUserIdsByCustomerId)
      .mockResolvedValue(linkedUsers.map((user) => user.id));
    identityUsersGateway.findByIds.mockResolvedValue(linkedUsers);

    emailSender.send.mockRejectedValueOnce(new Error('smtp down'));

    await expect(useCase.execute(input)).resolves.toBeUndefined();

    expect(workOrder.status).toBe(WorkOrderStatus.AWAITING_PAYMENT);

    expect(emailSender.send).toHaveBeenCalledWith(
      expect.objectContaining({ toEmail: 'second@example.com' }),
    );
  });

  it('should encode the quotes of the checkout link in the e-mail', async () => {
    await useCase.execute({
      ...input,
      checkoutUrl: 'https://pay.example.com/c/1"onmouseover="alert(1)',
    });

    const [email] = emailSender.send.mock.calls[0];

    expect(email.message.html).toContain(
      '<a href="https://pay.example.com/c/1%22onmouseover=%22alert(1)">',
    );
    expect(email.message.text).toContain(
      'Link para pagamento: https://pay.example.com/c/1%22onmouseover=%22alert(1)',
    );
  });

  it('should delete the work order cache key only after the hold', async () => {
    const steps: string[] = [];

    unitOfWork.executeTransaction.mockImplementation(async (work) => {
      const result = await work(repos);

      steps.push('commit');

      return result;
    });

    cache.delete.mockImplementation(() => {
      steps.push('cache.delete');

      return Promise.resolve();
    });

    await useCase.execute(input);

    expect(steps).toEqual(['commit', 'cache.delete']);
    expect(cache.delete).toHaveBeenCalledWith([workOrderCacheKey(workOrder.id)]);
  });
});
