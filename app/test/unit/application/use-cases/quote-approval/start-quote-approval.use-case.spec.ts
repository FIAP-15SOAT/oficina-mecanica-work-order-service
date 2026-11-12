import { SagaFailureReason } from '@domain/enums/saga-failure-reason.enum';
import { SagaStatus } from '@domain/enums/saga-status.enum';
import { SagaType } from '@domain/enums/saga-type.enum';
import { WorkOrderStatus } from '@domain/enums/work-order-status.enum';
import { IRepositories, IUnitOfWork } from '@domain/interfaces/repositories/unit-of-work.interface';

import { workOrderCacheKey } from '@application/keys/work-order-cache-key';
import { BUSINESS_EVENTS } from '@application/logging/business-event.catalog';
import { StartQuoteApprovalInputDto } from '@application/ports/input/quote-approval/dto/start-quote-approval.dto';
import { ICache } from '@application/ports/output/services/cache.service.interface';
import { ILogger } from '@application/ports/output/services/logger.service.interface';
import { IMetrics } from '@application/ports/output/services/metrics.service.interface';
import { StartQuoteApprovalUseCase } from '@application/use-cases/quote-approval/start-quote-approval.use-case';

import { createMockCache } from '../../../../helpers/cache-mock.factory';
import { createMockLogger } from '../../../../helpers/logger-mock.factory';
import { createMockMetrics } from '../../../../helpers/metrics-mock.factory';
import { createMockSagaInstance } from '../../../../helpers/saga-instance-mock.factory';
import {
  arrangeStatusHistory,
  createMockStatusHistory,
} from '../../../../helpers/status-history-mock.factory';
import { createMockUnitOfWorkWithRepos } from '../../../../helpers/unit-of-work-mock.factory';
import { createMockWorkOrder } from '../../../../helpers/work-order-mock.factory';

describe('StartQuoteApprovalUseCase', () => {
  let useCase: StartQuoteApprovalUseCase;
  let unitOfWork: jest.Mocked<IUnitOfWork>;
  let repos: jest.Mocked<IRepositories>;
  let logger: jest.Mocked<ILogger>;
  let metrics: jest.Mocked<IMetrics>;
  let cache: jest.Mocked<ICache>;

  const workOrderId = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
  const quoteId = '7e2a3b4c-5d6e-4f7a-8b9c-0d1e2f3a4b5c';
  const decidedBy = '9c8b7a6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
  const serviceId = '2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e';
  const partSupplyId = '3c4d5e6f-7a8b-4c9d-8e1f-2a3b4c5d6e7f';

  const servicesOnly: StartQuoteApprovalInputDto = {
    quoteId,
    workOrderId,
    decidedBy,
    services: [{ serviceId, quantity: 1, unitPrice: 200 }],
    partsSupplies: [],
  };

  const withParts: StartQuoteApprovalInputDto = {
    ...servicesOnly,
    partsSupplies: [{ partSupplyId, quantity: 3, unitPrice: 50 }],
  };

  beforeEach(() => {
    ({ unitOfWork, repos } = createMockUnitOfWorkWithRepos());

    logger = createMockLogger();

    metrics = createMockMetrics();

    cache = createMockCache();

    useCase = new StartQuoteApprovalUseCase(
      unitOfWork,
      logger,
      metrics,
      repos.statusHistory,
      cache,
    );
  });

  it('should start the saga reserving stock and write the reserve command with the event parts', async () => {
    const workOrder = createMockWorkOrder({
      id: workOrderId,
      status: WorkOrderStatus.AWAITING_APPROVAL,
    });

    jest.mocked(repos.workOrder.findByIdWithDetails).mockResolvedValue(workOrder);

    await useCase.execute(withParts);

    expect(repos.sagaInstance.findByTypeAndCorrelationId).toHaveBeenCalledWith(
      SagaType.QUOTE_APPROVAL,
      quoteId,
    );

    expect(repos.workOrder.findByIdWithDetails).toHaveBeenCalledWith(workOrderId);
    expect(workOrder.status).toBe(WorkOrderStatus.AWAITING_APPROVAL);
    expect(repos.workOrder.update).toHaveBeenCalledWith(workOrder);

    expect(repos.sagaInstance.create).toHaveBeenCalledWith(
      expect.objectContaining({
        type: SagaType.QUOTE_APPROVAL,
        correlationId: quoteId,
        workOrderId,
        status: SagaStatus.RESERVING_STOCK,
        failureReason: null,
      }),
    );

    expect(repos.outbox.add).toHaveBeenCalledWith({
      type: 'inventory.stock.reserve',
      workOrderId,
      payload: { quoteId, items: [{ partSupplyId, quantity: 3 }] },
    });

    expect(repos.workOrder.addServiceItems).not.toHaveBeenCalled();
    expect(repos.statusHistory.create).not.toHaveBeenCalled();
    expect(cache.delete).not.toHaveBeenCalled();
    expect(metrics.record).not.toHaveBeenCalled();

    expect(logger.event).toHaveBeenCalledWith(BUSINESS_EVENTS.QUOTE_APPROVAL_STARTED, {
      sagaId: expect.any(String),
      quoteId,
      workOrderId,
      workOrderNumber: workOrder.number.toString(),
    });
  });

  it('should approve the work order with the event items and complete the saga when the quote has no parts', async () => {
    const workOrder = createMockWorkOrder({
      id: workOrderId,
      status: WorkOrderStatus.AWAITING_APPROVAL,
    });

    jest.mocked(repos.workOrder.findByIdWithDetails).mockResolvedValue(workOrder);

    arrangeStatusHistory(
      repos.statusHistory,
      [
        createMockStatusHistory({
          workOrderId,
          previousStatus: WorkOrderStatus.IN_DIAGNOSIS,
          newStatus: WorkOrderStatus.AWAITING_APPROVAL,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
        }),
      ],
      new Date('2026-01-01T02:00:00.000Z'),
    );

    await useCase.execute(servicesOnly);

    expect(workOrder.status).toBe(WorkOrderStatus.APPROVED);
    expect(workOrder.totalAmount).toBe(200);
    expect(repos.workOrder.update).toHaveBeenCalledWith(workOrder);

    expect(repos.workOrder.addServiceItems).toHaveBeenCalledWith([
      expect.objectContaining({ workOrderId, serviceId, quantity: 1, unitPrice: 200 }),
    ]);

    expect(repos.sagaInstance.create).toHaveBeenCalledWith(
      expect.objectContaining({ correlationId: quoteId, status: SagaStatus.COMPLETED }),
    );

    expect(repos.statusHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        workOrderId,
        changedById: decidedBy,
        previousStatus: WorkOrderStatus.AWAITING_APPROVAL,
        newStatus: WorkOrderStatus.APPROVED,
      }),
    );

    expect(repos.outbox.add).not.toHaveBeenCalled();
    expect(cache.delete).toHaveBeenCalledWith([workOrderCacheKey(workOrderId)]);

    expect(logger.event).toHaveBeenCalledWith(BUSINESS_EVENTS.QUOTE_APPROVAL_COMPLETED, {
      sagaId: expect.any(String),
      quoteId,
      workOrderId,
      workOrderNumber: workOrder.number.toString(),
    });

    expect(metrics.record).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'work_order.status.duration' }),
      2 * 3600,
      { workOrderStatus: WorkOrderStatus.AWAITING_APPROVAL },
    );
  });

  it('should request the reversal to REJECTED when the work order is not awaiting approval', async () => {
    const workOrder = createMockWorkOrder({ id: workOrderId, status: WorkOrderStatus.CANCELLED });

    jest.mocked(repos.workOrder.findByIdWithDetails).mockResolvedValue(workOrder);

    await useCase.execute(withParts);

    expect(workOrder.status).toBe(WorkOrderStatus.CANCELLED);
    expect(repos.workOrder.update).toHaveBeenCalledWith(workOrder);

    expect(repos.sagaInstance.create).toHaveBeenCalledWith(
      expect.objectContaining({
        correlationId: quoteId,
        workOrderId,
        status: SagaStatus.COMPENSATING,
        failureReason: SagaFailureReason.WORK_ORDER_NOT_AWAITING,
      }),
    );

    expect(repos.outbox.add).toHaveBeenCalledWith({
      type: 'billing.quote.revert_approval',
      workOrderId,
      payload: { quoteId, revertTo: 'REJECTED' },
    });

    expect(repos.workOrder.addServiceItems).not.toHaveBeenCalled();
    expect(repos.statusHistory.create).not.toHaveBeenCalled();
    expect(cache.delete).not.toHaveBeenCalled();
    expect(metrics.record).not.toHaveBeenCalled();

    expect(logger.event).toHaveBeenCalledWith(
      BUSINESS_EVENTS.QUOTE_APPROVAL_COMPENSATION_REQUESTED,
      {
        sagaId: expect.any(String),
        quoteId,
        workOrderId,
        workOrderNumber: workOrder.number.toString(),
        sagaFailureReason: SagaFailureReason.WORK_ORDER_NOT_AWAITING,
      },
    );
  });

  it('should reopen the saga compensated for insufficient stock and request the reservation again', async () => {
    const saga = createMockSagaInstance({
      correlationId: quoteId,
      workOrderId,
      status: SagaStatus.COMPENSATED,
      failureReason: SagaFailureReason.INSUFFICIENT_STOCK,
    });

    jest.mocked(repos.sagaInstance.findByTypeAndCorrelationId).mockResolvedValue(saga);

    jest
      .mocked(repos.workOrder.findByIdWithDetails)
      .mockResolvedValue(
        createMockWorkOrder({ id: workOrderId, status: WorkOrderStatus.AWAITING_APPROVAL }),
      );

    await useCase.execute(withParts);

    expect(saga.status).toBe(SagaStatus.RESERVING_STOCK);
    expect(saga.failureReason).toBeNull();
    expect(repos.sagaInstance.update).toHaveBeenCalledWith(saga);
    expect(repos.sagaInstance.create).not.toHaveBeenCalled();

    expect(repos.outbox.add).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'inventory.stock.reserve', workOrderId }),
    );

    expect(logger.event).toHaveBeenCalledWith(
      BUSINESS_EVENTS.QUOTE_APPROVAL_STARTED,
      expect.objectContaining({ sagaId: saga.id, quoteId }),
    );
  });

  it('should reopen the compensated saga to request the reversal when the work order is no longer awaiting approval', async () => {
    const saga = createMockSagaInstance({
      correlationId: quoteId,
      workOrderId,
      status: SagaStatus.COMPENSATED,
      failureReason: SagaFailureReason.INSUFFICIENT_STOCK,
    });

    const workOrder = createMockWorkOrder({ id: workOrderId, status: WorkOrderStatus.CANCELLED });

    jest.mocked(repos.sagaInstance.findByTypeAndCorrelationId).mockResolvedValue(saga);

    jest.mocked(repos.workOrder.findByIdWithDetails).mockResolvedValue(workOrder);

    await useCase.execute(withParts);

    expect(saga.status).toBe(SagaStatus.COMPENSATING);
    expect(saga.failureReason).toBe(SagaFailureReason.WORK_ORDER_NOT_AWAITING);
    expect(workOrder.status).toBe(WorkOrderStatus.CANCELLED);
    expect(repos.sagaInstance.update).toHaveBeenCalledWith(saga);
    expect(repos.sagaInstance.create).not.toHaveBeenCalled();

    expect(repos.outbox.add).toHaveBeenCalledWith({
      type: 'billing.quote.revert_approval',
      workOrderId,
      payload: { quoteId, revertTo: 'REJECTED' },
    });
  });

  it.each([
    ['RESERVING_STOCK', SagaStatus.RESERVING_STOCK, null],
    ['COMPENSATING', SagaStatus.COMPENSATING, SagaFailureReason.INSUFFICIENT_STOCK],
    ['COMPLETED', SagaStatus.COMPLETED, null],
    [
      'COMPENSATED by WORK_ORDER_NOT_AWAITING',
      SagaStatus.COMPENSATED,
      SagaFailureReason.WORK_ORDER_NOT_AWAITING,
    ],
  ])(
    'should skip a repeated approval when the saga is %s',
    async (_label, status, failureReason) => {
      jest
        .mocked(repos.sagaInstance.findByTypeAndCorrelationId)
        .mockResolvedValue(createMockSagaInstance({ status, failureReason }));

      await useCase.execute(withParts);

      expect(repos.workOrder.findByIdWithDetails).not.toHaveBeenCalled();
      expect(repos.workOrder.update).not.toHaveBeenCalled();
      expect(repos.sagaInstance.create).not.toHaveBeenCalled();
      expect(repos.sagaInstance.update).not.toHaveBeenCalled();
      expect(repos.outbox.add).not.toHaveBeenCalled();
      expect(cache.delete).not.toHaveBeenCalled();

      expect(logger.event).toHaveBeenCalledWith(BUSINESS_EVENTS.QUOTE_APPROVAL_STEP_SKIPPED, {
        quoteId,
        sagaStatus: status,
      });
    },
  );

  it.each([
    ['requesting the stock reservation', WorkOrderStatus.AWAITING_APPROVAL],
    ['requesting the approval reversal', WorkOrderStatus.CANCELLED],
  ])('should update the work order before writing the outbox when %s', async (_label, status) => {
    jest
      .mocked(repos.workOrder.findByIdWithDetails)
      .mockResolvedValue(createMockWorkOrder({ id: workOrderId, status }));

    await useCase.execute(withParts);

    expect(jest.mocked(repos.workOrder.update).mock.invocationCallOrder[0]).toBeLessThan(
      jest.mocked(repos.outbox.add).mock.invocationCallOrder[0],
    );
  });

  it('should leave cache, log and metric untouched when the transaction fails', async () => {
    unitOfWork.executeTransaction.mockRejectedValueOnce(new Error('commit failed'));

    await expect(useCase.execute(servicesOnly)).rejects.toThrow('commit failed');

    expect(cache.delete).not.toHaveBeenCalled();
    expect(logger.event).not.toHaveBeenCalled();
    expect(metrics.record).not.toHaveBeenCalled();
  });
});
