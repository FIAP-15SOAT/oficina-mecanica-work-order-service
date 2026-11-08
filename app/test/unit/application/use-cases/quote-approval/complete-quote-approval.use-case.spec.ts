import { randomUUID } from 'node:crypto';
import { CompleteQuoteApprovalUseCase } from '@application/use-cases/quote-approval/complete-quote-approval.use-case';
import { QuoteStatus } from '@domain/enums/quote-status.enum';
import { WorkOrderStatus } from '@domain/enums/work-order-status.enum';
import { SagaType } from '@domain/enums/saga-type.enum';
import { SagaStatus } from '@domain/enums/saga-status.enum';
import {
  createMockQuote,
  createMockQuotePartSupply,
  createMockQuoteService,
} from '../../../../helpers/quote-mock.factory';
import { createMockWorkOrder } from '../../../../helpers/work-order-mock.factory';
import { createMockSagaInstance } from '../../../../helpers/saga-instance-mock.factory';
import { createMockUnitOfWorkWithRepos } from '../../../../helpers/unit-of-work-mock.factory';
import { IUnitOfWork, IRepositories } from '@domain/interfaces/repositories/unit-of-work.interface';
import { ILogger } from '@application/ports/output/services/logger.service.interface';
import { createMockLogger } from '../../../../helpers/logger-mock.factory';
import { IMetrics } from '@application/ports/output/services/metrics.service.interface';
import { createMockMetrics } from '../../../../helpers/metrics-mock.factory';
import {
  arrangeStatusHistory,
  createMockStatusHistory,
} from '../../../../helpers/status-history-mock.factory';
import { ICache } from '@application/ports/output/services/cache.service.interface';
import { workOrderCacheKey } from '@application/keys/work-order-cache-key';
import { createMockCache } from '../../../../helpers/cache-mock.factory';
import { BUSINESS_EVENTS } from '@application/logging/business-event.catalog';

describe('CompleteQuoteApprovalUseCase', () => {
  let useCase: CompleteQuoteApprovalUseCase;
  let unitOfWork: jest.Mocked<IUnitOfWork>;
  let repos: jest.Mocked<IRepositories>;
  let logger: jest.Mocked<ILogger>;
  let metrics: jest.Mocked<IMetrics>;
  let cache: jest.Mocked<ICache>;

  beforeEach(() => {
    ({ unitOfWork, repos } = createMockUnitOfWorkWithRepos());

    logger = createMockLogger();

    metrics = createMockMetrics();

    cache = createMockCache();

    useCase = new CompleteQuoteApprovalUseCase(
      unitOfWork,
      logger,
      metrics,
      repos.statusHistory,
      cache,
    );
  });

  it('should approve the work order with the quote items and total, record the decision author and complete the saga', async () => {
    const decidedBy = randomUUID();

    const serviceItem = createMockQuoteService({ quantity: 1, unitPrice: 200, totalPrice: 200 });

    const partItem = createMockQuotePartSupply({ quantity: 3, unitPrice: 50, totalPrice: 150 });

    const quote = createMockQuote({
      status: QuoteStatus.APPROVED,
      decidedBy,
      services: [serviceItem],
      partsSupplies: [partItem],
    });

    const workOrder = createMockWorkOrder({
      id: quote.workOrderId,
      status: WorkOrderStatus.AWAITING_APPROVAL,
    });

    const saga = createMockSagaInstance({
      correlationId: quote.id,
      workOrderId: workOrder.id,
      status: SagaStatus.RESERVING_STOCK,
    });

    jest.mocked(repos.sagaInstance.findByTypeAndCorrelationId).mockResolvedValue(saga);

    jest.mocked(repos.quote.findByIdWithDetails).mockResolvedValue(quote);

    jest.mocked(repos.workOrder.findByIdWithDetails).mockResolvedValue(workOrder);

    arrangeStatusHistory(
      repos.statusHistory,
      [
        createMockStatusHistory({
          workOrderId: workOrder.id,
          previousStatus: WorkOrderStatus.IN_DIAGNOSIS,
          newStatus: WorkOrderStatus.AWAITING_APPROVAL,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
        }),
      ],
      new Date('2026-01-01T02:00:00.000Z'),
    );

    await useCase.execute(quote.id);

    expect(repos.sagaInstance.findByTypeAndCorrelationId).toHaveBeenCalledWith(
      SagaType.QUOTE_APPROVAL,
      quote.id,
    );

    expect(repos.workOrder.findByIdWithDetails).toHaveBeenCalledWith(saga.workOrderId);
    expect(workOrder.status).toBe(WorkOrderStatus.APPROVED);
    expect(workOrder.totalAmount).toBe(350);
    expect(repos.workOrder.addServiceItems).toHaveBeenCalledWith([
      expect.objectContaining({ serviceId: serviceItem.serviceId, quantity: 1, unitPrice: 200 }),
    ]);

    expect(repos.workOrder.addPartSupplyItems).toHaveBeenCalledWith([
      expect.objectContaining({ partSupplyId: partItem.partSupplyId, quantity: 3, unitPrice: 50 }),
    ]);

    expect(repos.statusHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        workOrderId: workOrder.id,
        changedById: decidedBy,
        previousStatus: WorkOrderStatus.AWAITING_APPROVAL,
        newStatus: WorkOrderStatus.APPROVED,
      }),
    );

    expect(saga.status).toBe(SagaStatus.COMPLETED);
    expect(repos.sagaInstance.update).toHaveBeenCalledWith(saga);
    expect(jest.mocked(repos.workOrder.update).mock.invocationCallOrder[0]).toBeLessThan(
      jest.mocked(repos.workOrder.addServiceItems).mock.invocationCallOrder[0],
    );

    expect(cache.delete).toHaveBeenCalledWith([workOrderCacheKey(workOrder.id)]);
    expect(logger.event).toHaveBeenCalledWith(BUSINESS_EVENTS.QUOTE_APPROVAL_COMPLETED, {
      sagaId: saga.id,
      quoteId: quote.id,
      workOrderId: workOrder.id,
      workOrderNumber: workOrder.number.toString(),
    });

    expect(metrics.record).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'work_order.status.duration' }),
      2 * 3600,
      { workOrderStatus: WorkOrderStatus.AWAITING_APPROVAL },
    );
  });

  it.each([
    ['COMPLETED', SagaStatus.COMPLETED],
    ['COMPENSATED', SagaStatus.COMPENSATED],
    ['missing', undefined],
  ])('should skip a reservation confirmation when the saga is %s', async (_label, sagaStatus) => {
    const quoteId = randomUUID();

    jest
      .mocked(repos.sagaInstance.findByTypeAndCorrelationId)
      .mockResolvedValue(sagaStatus ? createMockSagaInstance({ status: sagaStatus }) : null);

    await useCase.execute(quoteId);

    expect(repos.workOrder.update).not.toHaveBeenCalled();
    expect(repos.sagaInstance.update).not.toHaveBeenCalled();
    expect(repos.statusHistory.create).not.toHaveBeenCalled();
    expect(cache.delete).not.toHaveBeenCalled();
    expect(logger.event).toHaveBeenCalledWith(BUSINESS_EVENTS.QUOTE_APPROVAL_STEP_SKIPPED, {
      quoteId,
      sagaStatus,
    });
  });

  it('should leave cache, log and metric untouched when the transaction fails', async () => {
    unitOfWork.executeTransaction.mockRejectedValueOnce(new Error('commit failed'));

    await expect(useCase.execute(randomUUID())).rejects.toThrow('commit failed');

    expect(cache.delete).not.toHaveBeenCalled();
    expect(logger.event).not.toHaveBeenCalled();
    expect(metrics.record).not.toHaveBeenCalled();
  });
});
