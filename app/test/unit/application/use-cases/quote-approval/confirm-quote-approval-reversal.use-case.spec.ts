import { randomUUID } from 'node:crypto';
import { ConfirmQuoteApprovalReversalUseCase } from '@application/use-cases/quote-approval/confirm-quote-approval-reversal.use-case';
import { WorkOrderStatus } from '@domain/enums/work-order-status.enum';
import { SagaType } from '@domain/enums/saga-type.enum';
import { SagaStatus } from '@domain/enums/saga-status.enum';
import { SagaFailureReason } from '@domain/enums/saga-failure-reason.enum';
import { createMockWorkOrder } from '../../../../helpers/work-order-mock.factory';
import {
  createMockSagaInstance,
  createMockSagaInstanceRepository,
} from '../../../../helpers/saga-instance-mock.factory';
import { createMockCustomerEmailRecipientsResolver } from '../../../../helpers/customer-email-recipients-resolver-mock.factory';
import { createMockUnitOfWorkWithRepos } from '../../../../helpers/unit-of-work-mock.factory';
import { IUnitOfWork, IRepositories } from '@domain/interfaces/repositories/unit-of-work.interface';
import { ILogger } from '@application/ports/output/services/logger.service.interface';
import { createMockLogger } from '../../../../helpers/logger-mock.factory';
import { ISagaInstanceRepository } from '@domain/interfaces/repositories/saga-instance.repository.interface';
import {
  CustomerEmailRecipient,
  CustomerEmailRecipientsResolver,
} from '@application/services/customer-email-recipients';
import { WorkOrderEmailComposer } from '@application/notifications/work-order-email.composer';
import { BUSINESS_EVENTS } from '@application/logging/business-event.catalog';
import { BUSINESS_METRICS } from '@application/metrics/business-metric.catalog';
import { IMetrics } from '@application/ports/output/services/metrics.service.interface';
import { createMockMetrics } from '../../../../helpers/metrics-mock.factory';
import { WorkOrder } from '@domain/entities/work-order.entity';
import { SagaInstance } from '@domain/entities/saga-instance.entity';

describe('ConfirmQuoteApprovalReversalUseCase', () => {
  let useCase: ConfirmQuoteApprovalReversalUseCase;
  let unitOfWork: jest.Mocked<IUnitOfWork>;
  let repos: jest.Mocked<IRepositories>;
  let sagaInstanceRepository: jest.Mocked<ISagaInstanceRepository>;
  let customerEmailRecipientsResolver: jest.Mocked<CustomerEmailRecipientsResolver>;
  let logger: jest.Mocked<ILogger>;
  let metrics: jest.Mocked<IMetrics>;
  let recipients: CustomerEmailRecipient[];
  let quoteId: string;
  let workOrder: WorkOrder;
  let saga: SagaInstance;

  beforeEach(() => {
    ({ unitOfWork, repos } = createMockUnitOfWorkWithRepos());

    sagaInstanceRepository = createMockSagaInstanceRepository();

    customerEmailRecipientsResolver = createMockCustomerEmailRecipientsResolver();

    logger = createMockLogger();

    metrics = createMockMetrics();

    quoteId = randomUUID();

    recipients = [
      { email: 'joao@example.com', name: 'João Lima', hasAccess: true },
      { email: 'ana@example.com', name: 'Ana Reis', hasAccess: true },
    ];

    workOrder = createMockWorkOrder({ status: WorkOrderStatus.AWAITING_APPROVAL });

    saga = createMockSagaInstance({
      correlationId: quoteId,
      workOrderId: workOrder.id,
      status: SagaStatus.COMPENSATING,
      failureReason: SagaFailureReason.INSUFFICIENT_STOCK,
    });

    sagaInstanceRepository.findByTypeAndCorrelationId.mockResolvedValue(saga);

    customerEmailRecipientsResolver.resolveForWorkOrder.mockResolvedValue(recipients);

    jest.mocked(repos.sagaInstance.findByTypeAndCorrelationId).mockResolvedValue(saga);

    jest.mocked(repos.workOrder.findById).mockResolvedValue(workOrder);

    useCase = new ConfirmQuoteApprovalReversalUseCase(
      unitOfWork,
      sagaInstanceRepository,
      customerEmailRecipientsResolver,
      logger,
      metrics,
    );
  });

  it('should compensate the saga and record the reversal for missing stock in the history', async () => {
    await useCase.execute(quoteId);

    expect(repos.sagaInstance.findByTypeAndCorrelationId).toHaveBeenCalledWith(
      SagaType.QUOTE_APPROVAL,
      quoteId,
    );

    expect(saga.status).toBe(SagaStatus.COMPENSATED);
    expect(repos.sagaInstance.update).toHaveBeenCalledWith(saga);

    expect(repos.statusHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        workOrderId: workOrder.id,
        changedById: null,
        previousStatus: WorkOrderStatus.AWAITING_APPROVAL,
        newStatus: WorkOrderStatus.AWAITING_APPROVAL,
        notes: `Aprovação do orçamento ${quoteId} desfeita por falta de estoque`,
      }),
    );

    expect(workOrder.status).toBe(WorkOrderStatus.AWAITING_APPROVAL);

    expect(logger.event).toHaveBeenCalledTimes(1);
    expect(logger.event).toHaveBeenCalledWith(BUSINESS_EVENTS.SAGA_COMPENSATED, {
      sagaId: saga.id,
      sagaType: SagaType.QUOTE_APPROVAL,
      sagaStatus: SagaStatus.COMPENSATED,
      quoteId,
      workOrderId: workOrder.id,
      workOrderNumber: workOrder.number.toString(),
      sagaFailureReason: SagaFailureReason.INSUFFICIENT_STOCK,
    });

    expect(metrics.increment).toHaveBeenCalledTimes(1);
    expect(metrics.increment).toHaveBeenCalledWith(BUSINESS_METRICS.SAGA_FINISHED, {
      sagaType: SagaType.QUOTE_APPROVAL,
      sagaOutcome: 'compensated',
    });
  });

  it('should time the saga from the update timestamp the repository saved', async () => {
    jest.mocked(repos.sagaInstance.update).mockResolvedValue(
      createMockSagaInstance({
        correlationId: quoteId,
        status: SagaStatus.COMPENSATED,
        failureReason: SagaFailureReason.INSUFFICIENT_STOCK,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:10:00.000Z'),
      }),
    );

    await useCase.execute(quoteId);

    expect(metrics.record).toHaveBeenCalledWith(BUSINESS_METRICS.SAGA_DURATION, 600, {
      sagaType: SagaType.QUOTE_APPROVAL,
      sagaOutcome: 'compensated',
    });
  });

  it('should add the stock shortage e-mail for each recipient in the transaction of the compensation', async () => {
    await useCase.execute(quoteId);

    expect(sagaInstanceRepository.findByTypeAndCorrelationId).toHaveBeenCalledWith(
      SagaType.QUOTE_APPROVAL,
      quoteId,
    );

    expect(customerEmailRecipientsResolver.resolveForWorkOrder).toHaveBeenCalledWith(workOrder.id);

    expect(
      customerEmailRecipientsResolver.resolveForWorkOrder.mock.invocationCallOrder[0],
    ).toBeLessThan(unitOfWork.executeTransaction.mock.invocationCallOrder[0]);

    expect(repos.outbox.add).toHaveBeenCalledTimes(2);

    for (const [index, recipient] of recipients.entries()) {
      expect(repos.outbox.add).toHaveBeenNthCalledWith(
        index + 1,
        WorkOrderEmailComposer.quoteApprovalReverted({
          recipient,
          workOrderId: workOrder.id,
          workOrderNumber: workOrder.number.toString(),
        }),
      );
    }

    expect(repos.workOrder.update).toHaveBeenCalledWith(workOrder);

    expect(jest.mocked(repos.workOrder.update).mock.invocationCallOrder[0]).toBeLessThan(
      jest.mocked(repos.outbox.add).mock.invocationCallOrder[0],
    );
  });

  it('should open no transaction when the recipients cannot be resolved', async () => {
    customerEmailRecipientsResolver.resolveForWorkOrder.mockRejectedValue(
      new Error('identity down'),
    );

    await expect(useCase.execute(quoteId)).rejects.toThrow('identity down');

    expect(unitOfWork.executeTransaction).not.toHaveBeenCalled();
    expect(saga.status).toBe(SagaStatus.COMPENSATING);
  });

  it('should compensate a saga reverted because the work order was not awaiting approval without e-mailing anyone', async () => {
    const cancelledWorkOrder = createMockWorkOrder({ status: WorkOrderStatus.CANCELLED });

    const notAwaitingSaga = createMockSagaInstance({
      correlationId: quoteId,
      workOrderId: cancelledWorkOrder.id,
      status: SagaStatus.COMPENSATING,
      failureReason: SagaFailureReason.WORK_ORDER_NOT_AWAITING,
    });

    sagaInstanceRepository.findByTypeAndCorrelationId.mockResolvedValue(notAwaitingSaga);

    jest.mocked(repos.sagaInstance.findByTypeAndCorrelationId).mockResolvedValue(notAwaitingSaga);

    jest.mocked(repos.workOrder.findById).mockResolvedValue(cancelledWorkOrder);

    await useCase.execute(quoteId);

    expect(notAwaitingSaga.status).toBe(SagaStatus.COMPENSATED);

    expect(repos.statusHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        previousStatus: WorkOrderStatus.CANCELLED,
        newStatus: WorkOrderStatus.CANCELLED,
        notes: `Aprovação do orçamento ${quoteId} desfeita: a Ordem de Serviço não aguardava aprovação`,
      }),
    );

    expect(customerEmailRecipientsResolver.resolveForWorkOrder).not.toHaveBeenCalled();
    expect(repos.workOrder.update).not.toHaveBeenCalled();
    expect(repos.outbox.add).not.toHaveBeenCalled();

    expect(logger.event).toHaveBeenCalledWith(
      BUSINESS_EVENTS.SAGA_COMPENSATED,
      expect.objectContaining({ sagaFailureReason: SagaFailureReason.WORK_ORDER_NOT_AWAITING }),
    );
  });

  it.each([
    ['RESERVING_STOCK', SagaStatus.RESERVING_STOCK],
    ['COMPLETED', SagaStatus.COMPLETED],
    ['COMPENSATED', SagaStatus.COMPENSATED],
    ['missing', undefined],
  ])('should skip a reversal when the saga is %s', async (_label, sagaStatus) => {
    const settledSaga = sagaStatus ? createMockSagaInstance({ status: sagaStatus }) : null;

    sagaInstanceRepository.findByTypeAndCorrelationId.mockResolvedValue(settledSaga);

    jest.mocked(repos.sagaInstance.findByTypeAndCorrelationId).mockResolvedValue(settledSaga);

    await useCase.execute(quoteId);

    expect(customerEmailRecipientsResolver.resolveForWorkOrder).not.toHaveBeenCalled();
    expect(repos.sagaInstance.update).not.toHaveBeenCalled();
    expect(repos.statusHistory.create).not.toHaveBeenCalled();
    expect(repos.outbox.add).not.toHaveBeenCalled();

    expect(logger.event).toHaveBeenCalledWith(BUSINESS_EVENTS.SAGA_STEP_SKIPPED, {
      sagaType: SagaType.QUOTE_APPROVAL,
      quoteId,
      sagaStatus,
    });

    expect(metrics.increment).not.toHaveBeenCalled();
  });
});
