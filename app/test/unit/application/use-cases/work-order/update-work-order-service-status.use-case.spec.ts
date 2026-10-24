import { UpdateWorkOrderServiceStatusUseCase } from '@application/use-cases/work-order/update-work-order-service-status.use-case';
import { ResourceNotFoundException } from '@application/exceptions/resource-not-found.exception';
import { EntityNotFoundException } from '@domain/exceptions/entity-not-found.exception';
import { WorkOrderServiceStatus } from '@domain/enums/work-order-service-status.enum';
import { WorkOrderStatus } from '@domain/enums/work-order-status.enum';
import { BusinessRuleViolationException } from '@domain/exceptions/business-rule-violation.exception';
import { createMockWorkOrder } from '../../../../helpers/work-order-mock.factory';
import { createMockWorkOrderService } from '../../../../helpers/work-order-service-mock.factory';
import { createMockStockReservation } from '../../../../helpers/stock-reservation-mock.factory';
import { createMockPartSupply } from '../../../../helpers/part-supply-mock.factory';
import { createMockUnitOfWorkWithRepos } from '../../../../helpers/unit-of-work-mock.factory';
import { IUnitOfWork, IRepositories } from '@domain/interfaces/repositories/unit-of-work.interface';
import { randomUUID } from 'node:crypto';
import { ILogger } from '@application/ports/output/logger.service.interface';
import { createMockLogger } from '../../../../helpers/logger-mock.factory';
import { IMetrics } from '@application/ports/output/metrics.service.interface';
import { createMockMetrics } from '../../../../helpers/metrics-mock.factory';
import {
  arrangeStatusHistory,
  createMockStatusHistory,
} from '../../../../helpers/status-history-mock.factory';
import { ICache } from '@application/ports/output/cache.service.interface';
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
    it('should start service and create stock movements when WO is not yet IN_PROGRESS', async () => {
      const serviceId = randomUUID();
      const woService = createMockWorkOrderService({
        serviceId,
        status: WorkOrderServiceStatus.PENDING,
      });
      const workOrder = createMockWorkOrder({
        status: WorkOrderStatus.APPROVED,
        services: [woService],
      });
      const reservation = createMockStockReservation({ workOrderId: workOrder.id });
      const partSupply = createMockPartSupply({
        id: reservation.partSupplyId,
        stock: 10,
        reservedStock: 2,
      });

      (mockRepos.workOrder.findByIdWithDetails as jest.Mock).mockResolvedValue(workOrder);
      (mockRepos.stockReservation.findByWorkOrderId as jest.Mock).mockResolvedValue([reservation]);
      (mockRepos.partSupply.findByIds as jest.Mock).mockResolvedValue([partSupply]);
      (mockRepos.stockMovement.createMany as jest.Mock).mockResolvedValue(undefined);
      (mockRepos.partSupply.update as jest.Mock).mockResolvedValue(undefined);
      (mockRepos.stockReservation.deleteByWorkOrderId as jest.Mock).mockResolvedValue(undefined);
      (mockRepos.workOrder.updateServiceItemStatus as jest.Mock).mockResolvedValue(undefined);
      (mockRepos.workOrder.update as jest.Mock).mockResolvedValue(workOrder);
      (mockRepos.statusHistory.create as jest.Mock).mockResolvedValue({});

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
      expect(mockRepos.workOrder.update).not.toHaveBeenCalled();
      expect(mockRepos.statusHistory.create).toHaveBeenCalled();
      expect(mockRepos.stockMovement.createMany).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ partSupplyId: reservation.partSupplyId }),
        ]),
      );
      expect(mockRepos.stockReservation.deleteByWorkOrderId).toHaveBeenCalledWith(workOrder.id);
      expect(result.serviceId).toBe(serviceId);
    });

    it('should skip stock movements when WO transitions to IN_PROGRESS but has no reservations', async () => {
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
      (mockRepos.stockReservation.findByWorkOrderId as jest.Mock).mockResolvedValue([]);
      (mockRepos.workOrder.updateServiceItemStatus as jest.Mock).mockResolvedValue(undefined);
      (mockRepos.workOrder.update as jest.Mock).mockResolvedValue(workOrder);
      (mockRepos.statusHistory.create as jest.Mock).mockResolvedValue({});

      await useCase.execute({
        workOrderId: workOrder.id,
        serviceId,
        status: WorkOrderServiceStatus.IN_PROGRESS,
        userId: '550e8400-e29b-41d4-a716-446655440099',
      });

      expect(mockRepos.partSupply.findByIds).not.toHaveBeenCalled();
      expect(mockRepos.stockMovement.createMany).not.toHaveBeenCalled();
      expect(mockRepos.workOrder.update).not.toHaveBeenCalled();
    });

    it('should not create stock movements if WO is already IN_PROGRESS', async () => {
      const serviceId = randomUUID();
      const woService = createMockWorkOrderService({
        serviceId,
        status: WorkOrderServiceStatus.PENDING,
      });
      const workOrder = createMockWorkOrder({
        status: WorkOrderStatus.IN_PROGRESS,
        services: [woService],
      });

      (mockRepos.workOrder.findByIdWithDetails as jest.Mock).mockResolvedValue(workOrder);
      (mockRepos.workOrder.updateServiceItemStatus as jest.Mock).mockResolvedValue(undefined);

      await useCase.execute({
        workOrderId: workOrder.id,
        serviceId,
        status: WorkOrderServiceStatus.IN_PROGRESS,
        userId: '550e8400-e29b-41d4-a716-446655440099',
      });

      expect(mockRepos.stockReservation.findByWorkOrderId).not.toHaveBeenCalled();
      expect(mockRepos.workOrder.update).not.toHaveBeenCalled();
      expect(mockRepos.workOrder.updateServiceItemStatus).toHaveBeenCalled();
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
      (mockRepos.stockReservation.findByWorkOrderId as jest.Mock).mockResolvedValue([]);
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
     * O item de serviço mudou, a ordem não: sem entrada nova no histórico não
     * há permanência a fechar, e a leitura sequer acontece.
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
