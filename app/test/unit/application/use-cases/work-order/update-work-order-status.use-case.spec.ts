import { UpdateWorkOrderStatusUseCase } from '@application/use-cases/work-order/update-work-order-status.use-case';
import { WorkOrderStatus } from '@domain/enums/work-order-status.enum';
import { ResourceNotFoundException } from '@application/exceptions/resource-not-found.exception';
import { BusinessRuleViolationException } from '@domain/exceptions/business-rule-violation.exception';
import { createMockWorkOrder } from '../../../../helpers/work-order-mock.factory';
import { createMockUnitOfWorkWithRepos } from '../../../../helpers/unit-of-work-mock.factory';
import { IUnitOfWork, IRepositories } from '@domain/interfaces/repositories/unit-of-work.interface';
import { ILogger } from '@application/ports/output/logger.service.interface';
import { createMockLogger } from '../../../../helpers/logger-mock.factory';
import { IMetrics } from '@application/ports/output/metrics.service.interface';
import { createMockMetrics } from '../../../../helpers/metrics-mock.factory';
import { StatusHistory } from '@domain/entities/status-history.entity';
import {
  arrangeStatusHistory,
  createMockStatusHistory,
} from '../../../../helpers/status-history-mock.factory';
import { ICache } from '@application/ports/output/cache.service.interface';
import { workOrderCacheKey } from '@application/keys/work-order-cache-key';
import { createMockCache } from '../../../../helpers/cache-mock.factory';
import { randomUUID } from 'node:crypto';

describe('UpdateWorkOrderStatusUseCase', () => {
  let cache: jest.Mocked<ICache>;
  let useCase: UpdateWorkOrderStatusUseCase;
  let logger: jest.Mocked<ILogger>;
  let mockRepos: jest.Mocked<IRepositories>;
  let mockUow: jest.Mocked<IUnitOfWork>;
  let metrics: jest.Mocked<IMetrics>;

  beforeEach(() => {
    const { unitOfWork, repos } = createMockUnitOfWorkWithRepos();
    mockRepos = repos;
    mockUow = unitOfWork;
    metrics = createMockMetrics();
    logger = createMockLogger();
    cache = createMockCache();
    useCase = new UpdateWorkOrderStatusUseCase(
      mockUow,
      logger,
      metrics,
      mockRepos.statusHistory,
      cache,
    );
  });

  it('should transition RECEIVED -> IN_DIAGNOSIS', async () => {
    const wo = createMockWorkOrder({ status: WorkOrderStatus.RECEIVED });
    const updated = createMockWorkOrder({ ...wo, status: WorkOrderStatus.IN_DIAGNOSIS });

    (mockRepos.workOrder.findById as jest.Mock).mockResolvedValue(wo);
    (mockRepos.workOrder.update as jest.Mock).mockResolvedValue(updated);
    (mockRepos.statusHistory.create as jest.Mock).mockResolvedValue({});

    const result = await useCase.execute(wo.id, {
      status: WorkOrderStatus.IN_DIAGNOSIS,
      userId: '550e8400-e29b-41d4-a716-446655440099',
    });
    expect(result.status).toBe(WorkOrderStatus.IN_DIAGNOSIS);
  });

  it('should transition RECEIVED -> CANCELLED with notes', async () => {
    const wo = createMockWorkOrder({ status: WorkOrderStatus.RECEIVED });
    const updated = createMockWorkOrder({ ...wo, status: WorkOrderStatus.CANCELLED });

    (mockRepos.workOrder.findById as jest.Mock).mockResolvedValue(wo);
    (mockRepos.workOrder.update as jest.Mock).mockResolvedValue(updated);
    (mockRepos.statusHistory.create as jest.Mock).mockResolvedValue({});

    const result = await useCase.execute(wo.id, {
      status: WorkOrderStatus.CANCELLED,
      notes: 'Cancelado a pedido do cliente',
      userId: '550e8400-e29b-41d4-a716-446655440099',
    });
    expect(result.status).toBe(WorkOrderStatus.CANCELLED);
  });

  it('should transition COMPLETED -> DELIVERED', async () => {
    const wo = createMockWorkOrder({ status: WorkOrderStatus.COMPLETED });
    const updated = createMockWorkOrder({ ...wo, status: WorkOrderStatus.DELIVERED });

    (mockRepos.workOrder.findById as jest.Mock).mockResolvedValue(wo);
    (mockRepos.workOrder.update as jest.Mock).mockResolvedValue(updated);
    (mockRepos.statusHistory.create as jest.Mock).mockResolvedValue({});

    const result = await useCase.execute(wo.id, {
      status: WorkOrderStatus.DELIVERED,
      userId: '550e8400-e29b-41d4-a716-446655440099',
    });
    expect(result.status).toBe(WorkOrderStatus.DELIVERED);
  });

  it('should throw ResourceNotFoundException when work order not found', async () => {
    (mockRepos.workOrder.findById as jest.Mock).mockResolvedValue(null);

    await expect(
      useCase.execute('bad-id', {
        status: WorkOrderStatus.IN_DIAGNOSIS,
        userId: '550e8400-e29b-41d4-a716-446655440099',
      }),
    ).rejects.toThrow(ResourceNotFoundException);
  });

  it('should throw BusinessRuleViolationException for disallowed status via PATCH', async () => {
    const wo = createMockWorkOrder({ status: WorkOrderStatus.RECEIVED });
    (mockRepos.workOrder.findById as jest.Mock).mockResolvedValue(wo);

    // APPROVED is not in PATCH_STATUS_ALLOWED
    await expect(
      useCase.execute(wo.id, {
        status: WorkOrderStatus.APPROVED,
        userId: '550e8400-e29b-41d4-a716-446655440099',
      }),
    ).rejects.toThrow(BusinessRuleViolationException);
  });

  it('should throw BusinessRuleViolationException when CANCELLED without notes', async () => {
    const wo = createMockWorkOrder({ status: WorkOrderStatus.RECEIVED });
    (mockRepos.workOrder.findById as jest.Mock).mockResolvedValue(wo);

    await expect(
      useCase.execute(wo.id, {
        status: WorkOrderStatus.CANCELLED,
        userId: '550e8400-e29b-41d4-a716-446655440099',
      }),
    ).rejects.toThrow(BusinessRuleViolationException);
  });
  describe('dwell metrics', () => {
    const RECEIVED_AT = new Date('2026-01-01T00:00:00.000Z');
    const DIAGNOSED_AT = new Date('2026-01-01T02:00:00.000Z');

    function arrangeTransition() {
      const wo = createMockWorkOrder({ status: WorkOrderStatus.RECEIVED });
      const updated = createMockWorkOrder({ ...wo, status: WorkOrderStatus.IN_DIAGNOSIS });

      (mockRepos.workOrder.findById as jest.Mock).mockResolvedValue(wo);
      (mockRepos.workOrder.update as jest.Mock).mockResolvedValue(updated);
      arrangeStatusHistory(
        mockRepos.statusHistory,
        [
          createMockStatusHistory({
            workOrderId: updated.id,
            previousStatus: null,
            newStatus: WorkOrderStatus.RECEIVED,
            createdAt: RECEIVED_AT,
          }),
        ],
        DIAGNOSED_AT,
      );

      return updated;
    }

    it('should record the dwell in the left status, with the status as an attribute', async () => {
      const updated = arrangeTransition();

      await useCase.execute(updated.id, {
        status: WorkOrderStatus.IN_DIAGNOSIS,
        userId: '550e8400-e29b-41d4-a716-446655440099',
      });

      expect(metrics.record).toHaveBeenCalledTimes(1);
      expect(metrics.record).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'work_order.status.duration', unit: 's' }),
        2 * 3600,
        { workOrderStatus: WorkOrderStatus.RECEIVED },
      );
    });

    /**
     * The history read exists only for the metric, which is why it happens
     * **outside** the transaction. Inside it, a failure here would take the
     * business operation down too — with no local fix, because the transaction
     * would already be aborted and the COMMIT would become a silent ROLLBACK.
     */
    it('should read the history after the commit, not inside the transaction', async () => {
      const updated = arrangeTransition();
      const order: string[] = [];

      (mockUow.executeTransaction as jest.Mock).mockImplementation(
        async (work: (repos: IRepositories) => Promise<unknown>) => {
          const result = await work(mockRepos);
          order.push('commit');

          return result;
        },
      );
      (mockRepos.statusHistory.create as jest.Mock).mockImplementation((entry: StatusHistory) => {
        order.push('create');

        return Promise.resolve(entry);
      });
      (mockRepos.statusHistory.findByWorkOrderId as jest.Mock).mockImplementation(() => {
        order.push('read');

        return Promise.resolve([]);
      });

      await useCase.execute(updated.id, {
        status: WorkOrderStatus.IN_DIAGNOSIS,
        userId: '550e8400-e29b-41d4-a716-446655440099',
      });

      expect(order).toEqual(['create', 'commit', 'read']);
    });

    it('should not let a metric read failure break the already committed operation', async () => {
      const updated = arrangeTransition();

      (mockRepos.statusHistory.findByWorkOrderId as jest.Mock).mockRejectedValue(
        new Error('conexão perdida'),
      );

      await expect(
        useCase.execute(updated.id, {
          status: WorkOrderStatus.IN_DIAGNOSIS,
          userId: '550e8400-e29b-41d4-a716-446655440099',
        }),
      ).resolves.toBe(updated);

      expect(metrics.record).not.toHaveBeenCalled();
    });

    it('should not record a metric when the transaction throws', async () => {
      const wo = createMockWorkOrder({ status: WorkOrderStatus.RECEIVED });

      (mockRepos.workOrder.findById as jest.Mock).mockResolvedValue(wo);
      (mockRepos.workOrder.update as jest.Mock).mockRejectedValue(new Error('rollback'));

      await expect(
        useCase.execute(wo.id, {
          status: WorkOrderStatus.IN_DIAGNOSIS,
          userId: '550e8400-e29b-41d4-a716-446655440099',
        }),
      ).rejects.toThrow('rollback');

      expect(metrics.record).not.toHaveBeenCalled();
    });

    it('should emit only after the transaction returns', async () => {
      const updated = arrangeTransition();
      const calls: string[] = [];

      (mockUow.executeTransaction as jest.Mock).mockImplementation(
        async (work: (repos: IRepositories) => Promise<unknown>) => {
          const result = await work(mockRepos);
          calls.push('commit');

          return result;
        },
      );
      metrics.record.mockImplementation(() => {
        calls.push('record');
      });

      await useCase.execute(updated.id, {
        status: WorkOrderStatus.IN_DIAGNOSIS,
        userId: '550e8400-e29b-41d4-a716-446655440099',
      });

      expect(calls).toEqual(['commit', 'record']);
    });
  });

  it('should delete the work order cache keys after the commit', async () => {
    const workOrder = createMockWorkOrder({ status: WorkOrderStatus.RECEIVED });

    (mockRepos.workOrder.findById as jest.Mock).mockResolvedValue(workOrder);

    (mockRepos.workOrder.update as jest.Mock).mockResolvedValue(workOrder);

    (mockRepos.statusHistory.create as jest.Mock).mockResolvedValue({});

    await useCase.execute(workOrder.id, {
      status: WorkOrderStatus.IN_DIAGNOSIS,
      userId: '550e8400-e29b-41d4-a716-446655440099',
    });

    expect(cache.delete).toHaveBeenCalledWith([workOrderCacheKey(workOrder.id)]);

    expect(cache.delete.mock.invocationCallOrder[0]).toBeGreaterThan(
      jest.mocked(mockRepos.workOrder.update).mock.invocationCallOrder[0],
    );
  });

  it('should not touch the cache when the write fails', async () => {
    mockUow.executeTransaction.mockRejectedValueOnce(new Error('commit failed'));

    await expect(
      useCase.execute(randomUUID(), {
        status: WorkOrderStatus.IN_DIAGNOSIS,
        userId: '550e8400-e29b-41d4-a716-446655440099',
      }),
    ).rejects.toThrow('commit failed');

    expect(cache.delete).not.toHaveBeenCalled();
  });
});
