import { randomUUID } from 'node:crypto';

import { WorkOrder } from '@domain/entities/work-order.entity';
import { WorkOrderStatus } from '@domain/enums/work-order-status.enum';
import { IRepositories, IUnitOfWork } from '@domain/interfaces/repositories/unit-of-work.interface';

import { workOrderCacheKey } from '@application/keys/work-order-cache-key';
import { BUSINESS_EVENTS } from '@application/logging/business-event.catalog';
import { ApplyRejectedQuoteInputDto } from '@application/ports/input/work-order/dto/apply-rejected-quote.dto';
import { ICache } from '@application/ports/output/services/cache.service.interface';
import { ILogger } from '@application/ports/output/services/logger.service.interface';
import { IMetrics } from '@application/ports/output/services/metrics.service.interface';
import { ApplyRejectedQuoteUseCase } from '@application/use-cases/work-order/apply-rejected-quote.use-case';

import { createMockCache } from '../../../../helpers/cache-mock.factory';
import { createMockLogger } from '../../../../helpers/logger-mock.factory';
import { createMockMetrics } from '../../../../helpers/metrics-mock.factory';
import {
  arrangeStatusHistory,
  createMockStatusHistory,
} from '../../../../helpers/status-history-mock.factory';
import { createMockUnitOfWorkWithRepos } from '../../../../helpers/unit-of-work-mock.factory';
import { createMockWorkOrder } from '../../../../helpers/work-order-mock.factory';

describe('ApplyRejectedQuoteUseCase', () => {
  let useCase: ApplyRejectedQuoteUseCase;
  let unitOfWork: jest.Mocked<IUnitOfWork>;
  let repos: jest.Mocked<IRepositories>;
  let logger: jest.Mocked<ILogger>;
  let metrics: jest.Mocked<IMetrics>;
  let cache: jest.Mocked<ICache>;
  let workOrder: WorkOrder;
  let input: ApplyRejectedQuoteInputDto;

  beforeEach(() => {
    ({ unitOfWork, repos } = createMockUnitOfWorkWithRepos());

    logger = createMockLogger();

    metrics = createMockMetrics();

    cache = createMockCache();

    workOrder = createMockWorkOrder({ status: WorkOrderStatus.AWAITING_APPROVAL });

    input = {
      quoteId: randomUUID(),
      workOrderId: workOrder.id,
      reason: 'Valor acima do esperado',
      remainingSentCount: 0,
      decidedBy: randomUUID(),
    };

    jest.mocked(repos.workOrder.findById).mockResolvedValue(workOrder);

    useCase = new ApplyRejectedQuoteUseCase(
      unitOfWork,
      logger,
      metrics,
      repos.statusHistory,
      cache,
    );
  });

  it('should reject the work order with the reason and the author when no sent quote remains', async () => {
    await useCase.execute(input);

    expect(repos.workOrder.findById).toHaveBeenCalledWith(workOrder.id);
    expect(workOrder.status).toBe(WorkOrderStatus.REJECTED);
    expect(repos.workOrder.update).toHaveBeenCalledWith(workOrder);

    expect(repos.statusHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        workOrderId: workOrder.id,
        changedById: input.decidedBy,
        previousStatus: WorkOrderStatus.AWAITING_APPROVAL,
        newStatus: WorkOrderStatus.REJECTED,
        notes: 'Valor acima do esperado',
      }),
    );
  });

  it('should keep the work order awaiting approval while another quote is sent', async () => {
    await useCase.execute({ ...input, remainingSentCount: 1 });

    expect(workOrder.status).toBe(WorkOrderStatus.AWAITING_APPROVAL);
    expect(repos.workOrder.update).not.toHaveBeenCalled();
    expect(repos.statusHistory.create).not.toHaveBeenCalled();
    expect(cache.delete).not.toHaveBeenCalled();
    expect(logger.event).not.toHaveBeenCalled();
  });

  it.each([WorkOrderStatus.CANCELLED, WorkOrderStatus.APPROVED])(
    'should skip a work order in %s that is not awaiting approval',
    async (status) => {
      const outsideWorkOrder = createMockWorkOrder({ status });

      jest.mocked(repos.workOrder.findById).mockResolvedValue(outsideWorkOrder);

      await useCase.execute({ ...input, workOrderId: outsideWorkOrder.id });

      expect(outsideWorkOrder.status).toBe(status);
      expect(repos.workOrder.update).not.toHaveBeenCalled();
      expect(repos.statusHistory.create).not.toHaveBeenCalled();
      expect(cache.delete).not.toHaveBeenCalled();

      expect(logger.event).toHaveBeenCalledWith(BUSINESS_EVENTS.QUOTE_EVENT_SKIPPED, {
        quoteId: input.quoteId,
        workOrderId: outsideWorkOrder.id,
        currentWorkOrderStatus: status,
      });
    },
  );

  it('should delete the work order cache and record the transition after the commit', async () => {
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

    await useCase.execute(input);

    expect(cache.delete).toHaveBeenCalledWith([workOrderCacheKey(workOrder.id)]);

    expect(metrics.record).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'work_order.status.duration' }),
      2 * 3600,
      { workOrderStatus: WorkOrderStatus.AWAITING_APPROVAL },
    );
  });

  it('should leave cache and metric untouched when the transaction fails', async () => {
    unitOfWork.executeTransaction.mockRejectedValueOnce(new Error('commit failed'));

    await expect(useCase.execute(input)).rejects.toThrow('commit failed');

    expect(cache.delete).not.toHaveBeenCalled();
    expect(metrics.record).not.toHaveBeenCalled();
  });
});
