import { randomUUID } from 'node:crypto';

import { WorkOrder } from '@domain/entities/work-order.entity';
import { SagaFailureReason } from '@domain/enums/saga-failure-reason.enum';
import { SagaStatus } from '@domain/enums/saga-status.enum';
import { SagaType } from '@domain/enums/saga-type.enum';
import { WorkOrderStatus } from '@domain/enums/work-order-status.enum';
import { IRepositories, IUnitOfWork } from '@domain/interfaces/repositories/unit-of-work.interface';

import { workOrderCacheKey } from '@application/keys/work-order-cache-key';
import { BUSINESS_EVENTS } from '@application/logging/business-event.catalog';
import { BUSINESS_METRICS } from '@application/metrics/business-metric.catalog';
import { WorkOrderEmailComposer } from '@application/notifications/work-order-email.composer';
import { StartPaymentInputDto } from '@application/ports/input/payment/dto/start-payment.dto';
import { ICache } from '@application/ports/output/services/cache.service.interface';
import { ILogger } from '@application/ports/output/services/logger.service.interface';
import { IMetrics } from '@application/ports/output/services/metrics.service.interface';
import {
  CustomerEmailRecipient,
  CustomerEmailRecipientsResolver,
} from '@application/services/customer-email-recipients';
import { StartPaymentUseCase } from '@application/use-cases/payment/start-payment.use-case';

import { createMockCache } from '../../../../helpers/cache-mock.factory';
import { createMockCustomerEmailRecipientsResolver } from '../../../../helpers/customer-email-recipients-resolver-mock.factory';
import { createMockLogger } from '../../../../helpers/logger-mock.factory';
import { createMockMetrics } from '../../../../helpers/metrics-mock.factory';
import { createMockSagaInstance } from '../../../../helpers/saga-instance-mock.factory';
import {
  arrangeStatusHistory,
  createMockStatusHistory,
} from '../../../../helpers/status-history-mock.factory';
import { createMockUnitOfWorkWithRepos } from '../../../../helpers/unit-of-work-mock.factory';
import { createMockWorkOrder } from '../../../../helpers/work-order-mock.factory';

describe('StartPaymentUseCase', () => {
  let useCase: StartPaymentUseCase;
  let unitOfWork: jest.Mocked<IUnitOfWork>;
  let repos: jest.Mocked<IRepositories>;
  let recipientsResolver: jest.Mocked<CustomerEmailRecipientsResolver>;
  let logger: jest.Mocked<ILogger>;
  let metrics: jest.Mocked<IMetrics>;
  let cache: jest.Mocked<ICache>;
  let recipients: CustomerEmailRecipient[];
  let workOrder: WorkOrder;
  let input: StartPaymentInputDto;

  beforeEach(() => {
    ({ unitOfWork, repos } = createMockUnitOfWorkWithRepos());

    recipientsResolver = createMockCustomerEmailRecipientsResolver();

    logger = createMockLogger();

    metrics = createMockMetrics();

    cache = createMockCache();

    recipients = [
      { email: 'joao@example.com', name: 'João Lima', hasAccess: true },
      { email: 'ana@example.com', name: 'Ana Reis', hasAccess: true },
    ];

    workOrder = createMockWorkOrder({ status: WorkOrderStatus.APPROVED });

    input = {
      paymentId: randomUUID(),
      workOrderId: workOrder.id,
      amount: '350.00',
      checkoutUrl: 'https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=123',
      expiresAt: '2026-11-15T15:00:00.000Z',
    };

    recipientsResolver.resolveForWorkOrder.mockResolvedValue(recipients);

    jest.mocked(repos.workOrder.findById).mockResolvedValue(workOrder);

    useCase = new StartPaymentUseCase(
      unitOfWork,
      recipientsResolver,
      logger,
      metrics,
      repos.statusHistory,
      cache,
    );
  });

  it('should hold an approved work order, start the payment saga with its origin and add the link e-mail for each recipient', async () => {
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

    expect(recipientsResolver.resolveForWorkOrder).toHaveBeenCalledWith(workOrder.id);

    expect(recipientsResolver.resolveForWorkOrder.mock.invocationCallOrder[0]).toBeLessThan(
      unitOfWork.executeTransaction.mock.invocationCallOrder[0],
    );

    expect(repos.outbox.add).toHaveBeenCalledTimes(2);

    for (const [index, recipient] of recipients.entries()) {
      expect(repos.outbox.add).toHaveBeenNthCalledWith(
        index + 1,
        WorkOrderEmailComposer.paymentLink({
          recipient,
          workOrderId: workOrder.id,
          workOrderNumber: workOrder.number.toString(),
          amount: input.amount,
          checkoutUrl: input.checkoutUrl,
          expiresAt: input.expiresAt,
        }),
      );
    }

    expect(jest.mocked(repos.workOrder.update).mock.invocationCallOrder[0]).toBeLessThan(
      jest.mocked(repos.outbox.add).mock.invocationCallOrder[0],
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
    const completedWorkOrder = createMockWorkOrder({ status: WorkOrderStatus.COMPLETED });

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
    const startedWorkOrder = createMockWorkOrder({ status: WorkOrderStatus.IN_PROGRESS });

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

    expect(repos.outbox.add).toHaveBeenCalledTimes(1);
    expect(repos.outbox.add).toHaveBeenCalledWith({
      type: 'billing.payment.cancel',
      workOrderId: startedWorkOrder.id,
      payload: { paymentId: input.paymentId, reason: 'WORK_ORDER_NOT_PAYABLE' },
    });

    expect(jest.mocked(repos.workOrder.update).mock.invocationCallOrder[0]).toBeLessThan(
      jest.mocked(repos.outbox.add).mock.invocationCallOrder[0],
    );

    expect(repos.statusHistory.create).not.toHaveBeenCalled();
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
    expect(cache.delete).not.toHaveBeenCalled();

    expect(logger.event).toHaveBeenCalledWith(BUSINESS_EVENTS.SAGA_STEP_SKIPPED, {
      sagaType: SagaType.PAYMENT,
      paymentId: input.paymentId,
      sagaStatus,
    });
  });

  it('should not add a second e-mail when the payment saga already exists', async () => {
    await useCase.execute(input);

    jest.mocked(repos.sagaInstance.findByTypeAndCorrelationId).mockResolvedValue(
      createMockSagaInstance({
        type: SagaType.PAYMENT,
        correlationId: input.paymentId,
        status: SagaStatus.AWAITING_PAYMENT,
        originStatus: WorkOrderStatus.APPROVED,
      }),
    );

    await useCase.execute(input);

    expect(repos.sagaInstance.create).toHaveBeenCalledTimes(1);
    expect(repos.outbox.add).toHaveBeenCalledTimes(recipients.length);
  });

  it('should open no transaction when the recipients cannot be resolved', async () => {
    recipientsResolver.resolveForWorkOrder.mockRejectedValue(new Error('identity down'));

    await expect(useCase.execute(input)).rejects.toThrow('identity down');

    expect(unitOfWork.executeTransaction).not.toHaveBeenCalled();
    expect(workOrder.status).toBe(WorkOrderStatus.APPROVED);
    expect(cache.delete).not.toHaveBeenCalled();
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
