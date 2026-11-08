import { UpdateWorkOrderServiceStatusUseCase } from '@application/use-cases/work-order/update-work-order-service-status.use-case';
import { ResourceNotFoundException } from '@application/exceptions/resource-not-found.exception';
import { EntityNotFoundException } from '@domain/exceptions/entity-not-found.exception';
import { WorkOrderServiceStatus } from '@domain/enums/work-order-service-status.enum';
import { WorkOrderStatus } from '@domain/enums/work-order-status.enum';
import { BusinessRuleViolationException } from '@domain/exceptions/business-rule-violation.exception';
import { createMockWorkOrder } from '../../../../helpers/work-order-mock.factory';
import { createMockWorkOrderService } from '../../../../helpers/work-order-service-mock.factory';
import { createMockWorkOrderPartSupply } from '../../../../helpers/work-order-part-supply-mock.factory';
import { createMockUnitOfWorkWithRepos } from '../../../../helpers/unit-of-work-mock.factory';
import { IUnitOfWork, IRepositories } from '@domain/interfaces/repositories/unit-of-work.interface';
import { randomUUID } from 'node:crypto';
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

describe('UpdateWorkOrderServiceStatusUseCase', () => {
  let cache: jest.Mocked<ICache>;
  let useCase: UpdateWorkOrderServiceStatusUseCase;
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
    useCase = new UpdateWorkOrderServiceStatusUseCase(
      mockUow,
      logger,
      metrics,
      mockRepos.statusHistory,
      cache,
    );
  });

  describe('transition to IN_PROGRESS', () => {
    it('should write the consume command when the first started service moves a work order with parts to IN_PROGRESS', async () => {
      const serviceId = randomUUID();

      const workOrder = createMockWorkOrder({
        status: WorkOrderStatus.APPROVED,
        services: [
          createMockWorkOrderService({ serviceId, status: WorkOrderServiceStatus.PENDING }),
        ],
        partSupplies: [createMockWorkOrderPartSupply()],
      });

      jest.mocked(mockRepos.workOrder.findByIdWithDetails).mockResolvedValue(workOrder);

      jest.mocked(mockRepos.statusHistory.create).mockResolvedValue(createMockStatusHistory());

      const result = await useCase.execute({
        workOrderId: workOrder.id,
        serviceId,
        status: WorkOrderServiceStatus.IN_PROGRESS,
        userId: '550e8400-e29b-41d4-a716-446655440099',
      });

      expect(mockRepos.workOrder.updateServiceItemStatus).toHaveBeenCalledWith(
        expect.objectContaining({ id: workOrder.id }),
        expect.objectContaining({ serviceId }),
      );
      expect(mockRepos.outbox.add).toHaveBeenCalledWith({
        type: 'inventory.stock.consume',
        workOrderId: workOrder.id,
        payload: {},
      });

      expect(jest.mocked(mockRepos.outbox.add).mock.invocationCallOrder[0]).toBeGreaterThan(
        jest.mocked(mockRepos.workOrder.updateServiceItemStatus).mock.invocationCallOrder[0],
      );

      expect(mockRepos.statusHistory.create).toHaveBeenCalled();
      expect(result.serviceId).toBe(serviceId);
    });

    it('should not write the consume command for a work order without parts', async () => {
      const serviceId = randomUUID();

      const workOrder = createMockWorkOrder({
        status: WorkOrderStatus.APPROVED,
        services: [
          createMockWorkOrderService({ serviceId, status: WorkOrderServiceStatus.PENDING }),
        ],
      });

      jest.mocked(mockRepos.workOrder.findByIdWithDetails).mockResolvedValue(workOrder);

      jest.mocked(mockRepos.statusHistory.create).mockResolvedValue(createMockStatusHistory());

      await useCase.execute({
        workOrderId: workOrder.id,
        serviceId,
        status: WorkOrderServiceStatus.IN_PROGRESS,
        userId: '550e8400-e29b-41d4-a716-446655440099',
      });

      expect(mockRepos.workOrder.updateServiceItemStatus).toHaveBeenCalled();
      expect(mockRepos.outbox.add).not.toHaveBeenCalled();
    });

    it('should not write the consume command when the work order was already in progress', async () => {
      const serviceId = randomUUID();

      const workOrder = createMockWorkOrder({
        status: WorkOrderStatus.IN_PROGRESS,
        services: [
          createMockWorkOrderService({ serviceId, status: WorkOrderServiceStatus.PENDING }),
          createMockWorkOrderService({ status: WorkOrderServiceStatus.IN_PROGRESS }),
        ],
        partSupplies: [createMockWorkOrderPartSupply()],
      });

      jest.mocked(mockRepos.workOrder.findByIdWithDetails).mockResolvedValue(workOrder);

      await useCase.execute({
        workOrderId: workOrder.id,
        serviceId,
        status: WorkOrderServiceStatus.IN_PROGRESS,
        userId: '550e8400-e29b-41d4-a716-446655440099',
      });

      expect(mockRepos.workOrder.updateServiceItemStatus).toHaveBeenCalled();
      expect(mockRepos.outbox.add).not.toHaveBeenCalled();
    });

    it('should throw ResourceNotFoundException when work order not found', async () => {
      (mockRepos.workOrder.findById as jest.Mock).mockResolvedValue(null);

      await expect(
        useCase.execute({
          workOrderId: '550e8400-e29b-41d4-a716-446655440001',
          serviceId: '550e8400-e29b-41d4-a716-446655440002',
          status: WorkOrderServiceStatus.IN_PROGRESS,
          userId: '550e8400-e29b-41d4-a716-446655440099',
        }),
      ).rejects.toThrow(ResourceNotFoundException);
    });

    it('should throw EntityNotFoundException when service not found in work order', async () => {
      const workOrder = createMockWorkOrder({ services: [] });
      (mockRepos.workOrder.findByIdWithDetails as jest.Mock).mockResolvedValue(workOrder);

      await expect(
        useCase.execute({
          workOrderId: workOrder.id,
          serviceId: randomUUID(),
          status: WorkOrderServiceStatus.IN_PROGRESS,
          userId: '550e8400-e29b-41d4-a716-446655440099',
        }),
      ).rejects.toThrow(EntityNotFoundException);
    });

    it('should throw BusinessRuleViolationException when service is already IN_PROGRESS', async () => {
      const serviceId = randomUUID();
      const woService = createMockWorkOrderService({
        serviceId,
        status: WorkOrderServiceStatus.IN_PROGRESS,
      });
      const workOrder = createMockWorkOrder({
        status: WorkOrderStatus.IN_PROGRESS,
        services: [woService],
      });

      (mockRepos.workOrder.findByIdWithDetails as jest.Mock).mockResolvedValue(workOrder);

      await expect(
        useCase.execute({
          workOrderId: workOrder.id,
          serviceId,
          status: WorkOrderServiceStatus.IN_PROGRESS,
          userId: '550e8400-e29b-41d4-a716-446655440099',
        }),
      ).rejects.toThrow(BusinessRuleViolationException);
    });
  });

  describe('transition to COMPLETED', () => {
    it('should complete service and update WO to COMPLETED when all services are done', async () => {
      const serviceId = randomUUID();
      const woService = createMockWorkOrderService({
        serviceId,
        status: WorkOrderServiceStatus.IN_PROGRESS,
      });
      const workOrder = createMockWorkOrder({
        status: WorkOrderStatus.IN_PROGRESS,
        services: [woService],
      });

      (mockRepos.workOrder.findByIdWithDetails as jest.Mock).mockResolvedValue(workOrder);
      (mockRepos.workOrder.updateServiceItemStatus as jest.Mock).mockResolvedValue(undefined);
      (mockRepos.workOrder.update as jest.Mock).mockResolvedValue(workOrder);
      (mockRepos.statusHistory.create as jest.Mock).mockResolvedValue({});

      await useCase.execute({
        workOrderId: workOrder.id,
        serviceId,
        status: WorkOrderServiceStatus.COMPLETED,
        userId: '550e8400-e29b-41d4-a716-446655440099',
      });

      expect(mockRepos.workOrder.updateServiceItemStatus).toHaveBeenCalledWith(
        expect.objectContaining({ id: workOrder.id }),
        expect.objectContaining({ serviceId }),
      );
      expect(mockRepos.workOrder.update).not.toHaveBeenCalled();
      expect(mockRepos.statusHistory.create).toHaveBeenCalled();
    });

    it('should complete service but NOT update WO when other services remain', async () => {
      const serviceId = randomUUID();
      const completingService = createMockWorkOrderService({
        serviceId,
        status: WorkOrderServiceStatus.IN_PROGRESS,
      });
      const pendingService = createMockWorkOrderService({
        serviceId: randomUUID(),
        status: WorkOrderServiceStatus.PENDING,
      });
      const workOrder = createMockWorkOrder({
        status: WorkOrderStatus.IN_PROGRESS,
        services: [completingService, pendingService],
      });

      (mockRepos.workOrder.findByIdWithDetails as jest.Mock).mockResolvedValue(workOrder);
      (mockRepos.workOrder.updateServiceItemStatus as jest.Mock).mockResolvedValue(undefined);

      await useCase.execute({
        workOrderId: workOrder.id,
        serviceId,
        status: WorkOrderServiceStatus.COMPLETED,
        userId: '550e8400-e29b-41d4-a716-446655440099',
      });

      expect(mockRepos.workOrder.update).not.toHaveBeenCalled();
      expect(mockRepos.statusHistory.create).not.toHaveBeenCalled();
      expect(mockRepos.workOrder.updateServiceItemStatus).toHaveBeenCalled();
    });

    it('should throw BusinessRuleViolationException when service is already COMPLETED', async () => {
      const serviceId = randomUUID();
      const woService = createMockWorkOrderService({
        serviceId,
        status: WorkOrderServiceStatus.COMPLETED,
      });
      const workOrder = createMockWorkOrder({
        status: WorkOrderStatus.IN_PROGRESS,
        services: [woService],
      });

      (mockRepos.workOrder.findByIdWithDetails as jest.Mock).mockResolvedValue(workOrder);

      await expect(
        useCase.execute({
          workOrderId: workOrder.id,
          serviceId,
          status: WorkOrderServiceStatus.COMPLETED,
          userId: '550e8400-e29b-41d4-a716-446655440099',
        }),
      ).rejects.toThrow(BusinessRuleViolationException);
    });
  });
  describe('dwell metrics', () => {
    it('should record the dwell when the service item moves the work order status', async () => {
      const serviceId = randomUUID();
      const woService = createMockWorkOrderService({
        serviceId,
        status: WorkOrderServiceStatus.PENDING,
      });
      const workOrder = createMockWorkOrder({
        status: WorkOrderStatus.APPROVED,
        services: [woService],
      });

      (mockRepos.workOrder.findByIdWithDetails as jest.Mock).mockResolvedValue(workOrder);
      (mockRepos.workOrder.updateServiceItemStatus as jest.Mock).mockResolvedValue(undefined);
      arrangeStatusHistory(
        mockRepos.statusHistory,
        [
          createMockStatusHistory({
            workOrderId: workOrder.id,
            previousStatus: WorkOrderStatus.AWAITING_APPROVAL,
            newStatus: WorkOrderStatus.APPROVED,
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
          }),
        ],
        new Date('2026-01-01T05:00:00.000Z'),
      );

      await useCase.execute({
        workOrderId: workOrder.id,
        serviceId,
        status: WorkOrderServiceStatus.IN_PROGRESS,
        userId: '550e8400-e29b-41d4-a716-446655440099',
      });

      expect(metrics.record).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'work_order.status.duration' }),
        5 * 3600,
        { workOrderStatus: WorkOrderStatus.APPROVED },
      );
    });

    /**
     * The service item changed, the work order did not: with no new history
     * entry there is no dwell time to close, and the read does not even happen.
     */
    it('should not record a metric when the work order status does not change', async () => {
      const serviceId = randomUUID();
      const started = createMockWorkOrderService({
        serviceId,
        status: WorkOrderServiceStatus.PENDING,
      });
      const other = createMockWorkOrderService({
        serviceId: randomUUID(),
        status: WorkOrderServiceStatus.IN_PROGRESS,
      });
      const workOrder = createMockWorkOrder({
        status: WorkOrderStatus.IN_PROGRESS,
        services: [started, other],
      });

      (mockRepos.workOrder.findByIdWithDetails as jest.Mock).mockResolvedValue(workOrder);
      (mockRepos.workOrder.updateServiceItemStatus as jest.Mock).mockResolvedValue(undefined);

      await useCase.execute({
        workOrderId: workOrder.id,
        serviceId,
        status: WorkOrderServiceStatus.IN_PROGRESS,
        userId: '550e8400-e29b-41d4-a716-446655440099',
      });

      expect(metrics.record).not.toHaveBeenCalled();
      expect(mockRepos.statusHistory.findByWorkOrderId).not.toHaveBeenCalled();
    });
  });

  it('should delete the work order cache keys after the commit', async () => {
    const serviceId = randomUUID();

    const workOrder = createMockWorkOrder({
      status: WorkOrderStatus.IN_PROGRESS,
      services: [
        createMockWorkOrderService({ serviceId, status: WorkOrderServiceStatus.PENDING }),
        createMockWorkOrderService({ status: WorkOrderServiceStatus.PENDING }),
      ],
    });
    (mockRepos.workOrder.findByIdWithDetails as jest.Mock).mockResolvedValue(workOrder);
    (mockRepos.workOrder.updateServiceItemStatus as jest.Mock).mockResolvedValue(undefined);

    await useCase.execute({
      workOrderId: workOrder.id,
      serviceId,
      status: WorkOrderServiceStatus.IN_PROGRESS,
      userId: '550e8400-e29b-41d4-a716-446655440099',
    });

    expect(cache.delete).toHaveBeenCalledWith([workOrderCacheKey(workOrder.id)]);

    expect(cache.delete.mock.invocationCallOrder[0]).toBeGreaterThan(
      jest.mocked(mockRepos.workOrder.updateServiceItemStatus).mock.invocationCallOrder[0],
    );
  });

  it('should not touch the cache when the write fails', async () => {
    mockUow.executeTransaction.mockRejectedValueOnce(new Error('commit failed'));

    await expect(
      useCase.execute({
        workOrderId: randomUUID(),
        serviceId: randomUUID(),
        status: WorkOrderServiceStatus.IN_PROGRESS,
        userId: '550e8400-e29b-41d4-a716-446655440099',
      }),
    ).rejects.toThrow('commit failed');

    expect(cache.delete).not.toHaveBeenCalled();
  });
});
