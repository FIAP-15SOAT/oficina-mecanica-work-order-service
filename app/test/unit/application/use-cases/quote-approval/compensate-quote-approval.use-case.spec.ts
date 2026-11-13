import { randomUUID } from 'node:crypto';
import { CompensateQuoteApprovalUseCase } from '@application/use-cases/quote-approval/compensate-quote-approval.use-case';
import { WorkOrderStatus } from '@domain/enums/work-order-status.enum';
import { SagaType } from '@domain/enums/saga-type.enum';
import { SagaStatus } from '@domain/enums/saga-status.enum';
import { SagaFailureReason } from '@domain/enums/saga-failure-reason.enum';
import { createMockWorkOrder } from '../../../../helpers/work-order-mock.factory';
import { createMockSagaInstance } from '../../../../helpers/saga-instance-mock.factory';
import { createMockUnitOfWorkWithRepos } from '../../../../helpers/unit-of-work-mock.factory';
import { IUnitOfWork, IRepositories } from '@domain/interfaces/repositories/unit-of-work.interface';
import { ILogger } from '@application/ports/output/services/logger.service.interface';
import { createMockLogger } from '../../../../helpers/logger-mock.factory';
import { IMetrics } from '@application/ports/output/services/metrics.service.interface';
import { createMockMetrics } from '../../../../helpers/metrics-mock.factory';
import { BUSINESS_EVENTS } from '@application/logging/business-event.catalog';
import { WorkOrder } from '@domain/entities/work-order.entity';
import { SagaInstance } from '@domain/entities/saga-instance.entity';

describe('CompensateQuoteApprovalUseCase', () => {
  let useCase: CompensateQuoteApprovalUseCase;
  let unitOfWork: jest.Mocked<IUnitOfWork>;
  let repos: jest.Mocked<IRepositories>;
  let logger: jest.Mocked<ILogger>;
  let metrics: jest.Mocked<IMetrics>;
  let quoteId: string;
  let workOrder: WorkOrder;
  let saga: SagaInstance;

  beforeEach(() => {
    ({ unitOfWork, repos } = createMockUnitOfWorkWithRepos());

    logger = createMockLogger();

    metrics = createMockMetrics();

    quoteId = randomUUID();

    workOrder = createMockWorkOrder({ status: WorkOrderStatus.AWAITING_APPROVAL });

    saga = createMockSagaInstance({
      correlationId: quoteId,
      workOrderId: workOrder.id,
      status: SagaStatus.RESERVING_STOCK,
    });

    jest.mocked(repos.sagaInstance.findByTypeAndCorrelationId).mockResolvedValue(saga);

    jest.mocked(repos.workOrder.findById).mockResolvedValue(workOrder);

    useCase = new CompensateQuoteApprovalUseCase(unitOfWork, logger, metrics);
  });

  it('should move the saga to COMPENSATING and request the reversal to SENT', async () => {
    await useCase.execute({ quoteId, missingItemCount: 2 });

    expect(repos.sagaInstance.findByTypeAndCorrelationId).toHaveBeenCalledWith(
      SagaType.QUOTE_APPROVAL,
      quoteId,
    );

    expect(saga.status).toBe(SagaStatus.COMPENSATING);
    expect(saga.failureReason).toBe(SagaFailureReason.INSUFFICIENT_STOCK);
    expect(repos.sagaInstance.update).toHaveBeenCalledWith(saga);

    expect(repos.outbox.add).toHaveBeenCalledWith({
      type: 'billing.quote.revert_approval',
      workOrderId: workOrder.id,
      payload: { quoteId, revertTo: 'SENT' },
    });

    expect(logger.event).toHaveBeenCalledTimes(1);
    expect(logger.event).toHaveBeenCalledWith(BUSINESS_EVENTS.SAGA_COMPENSATION_STARTED, {
      sagaId: saga.id,
      sagaType: SagaType.QUOTE_APPROVAL,
      sagaStatus: SagaStatus.COMPENSATING,
      quoteId,
      workOrderId: workOrder.id,
      workOrderNumber: workOrder.number.toString(),
      sagaFailureReason: SagaFailureReason.INSUFFICIENT_STOCK,
      missingItemCount: 2,
    });

    expect(metrics.increment).not.toHaveBeenCalled();
    expect(metrics.record).not.toHaveBeenCalled();
  });

  it('should keep the work order awaiting approval and record no history', async () => {
    await useCase.execute({ quoteId, missingItemCount: 1 });

    expect(workOrder.status).toBe(WorkOrderStatus.AWAITING_APPROVAL);
    expect(repos.statusHistory.create).not.toHaveBeenCalled();
  });

  it('should update the work order before writing the outbox', async () => {
    await useCase.execute({ quoteId, missingItemCount: 1 });

    expect(repos.workOrder.update).toHaveBeenCalledWith(workOrder);

    expect(jest.mocked(repos.workOrder.update).mock.invocationCallOrder[0]).toBeLessThan(
      jest.mocked(repos.outbox.add).mock.invocationCallOrder[0],
    );
  });

  it.each([
    ['COMPENSATING', SagaStatus.COMPENSATING],
    ['COMPLETED', SagaStatus.COMPLETED],
    ['COMPENSATED', SagaStatus.COMPENSATED],
    ['missing', undefined],
  ])(
    'should skip a reservation failure when the saga is not reserving stock (%s)',
    async (_label, sagaStatus) => {
      jest
        .mocked(repos.sagaInstance.findByTypeAndCorrelationId)
        .mockResolvedValue(sagaStatus ? createMockSagaInstance({ status: sagaStatus }) : null);

      await useCase.execute({ quoteId, missingItemCount: 1 });

      expect(repos.workOrder.update).not.toHaveBeenCalled();
      expect(repos.sagaInstance.update).not.toHaveBeenCalled();
      expect(repos.outbox.add).not.toHaveBeenCalled();

      expect(logger.event).toHaveBeenCalledWith(BUSINESS_EVENTS.SAGA_STEP_SKIPPED, {
        sagaType: SagaType.QUOTE_APPROVAL,
        quoteId,
        sagaStatus,
      });
    },
  );
});
