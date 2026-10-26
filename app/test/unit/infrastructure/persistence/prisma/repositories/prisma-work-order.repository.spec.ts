import { randomUUID } from 'node:crypto';
import { Prisma } from '@generated/client';

import { PrismaWorkOrderRepository } from '@infrastructure/persistence/prisma/repositories/prisma-work-order.repository';

import { WorkOrder } from '@domain/entities/work-order.entity';
import { WorkOrderNumber } from '@domain/value-objects/work-order-number.vo';
import { WorkOrderService } from '@domain/entities/work-order-service.entity';
import { WorkOrderPartSupply } from '@domain/entities/work-order-part-supply.entity';
import { WorkOrderStatus } from '@domain/enums/work-order-status.enum';
import { SortDirection } from '@domain/enums/sort-direction.enum';

import { ConcurrencyException } from '@infrastructure/exceptions/concurrency.exception';
import { ResourceConflictException } from '@application/exceptions/resource-conflict.exception';

import {
  createMockPrismaClient,
  MockPrismaService,
} from '../../../../../helpers/prisma-mock.factory';

describe('PrismaWorkOrderRepository', () => {
  let repository: PrismaWorkOrderRepository;
  let prisma: MockPrismaService;

  beforeEach(() => {
    prisma = createMockPrismaClient();
    repository = new PrismaWorkOrderRepository(prisma);
  });

  describe('create', () => {
    it('should create a work order', async () => {
      const workOrder = WorkOrder.create({
        number: '000001',
        customerId: randomUUID(),
        vehicleId: randomUUID(),
      });

      prisma.workOrder.create.mockResolvedValue({
        ...workOrder,
        number: workOrder.number.toString(),
        status: workOrder.status,
        totalAmount: workOrder.totalAmount,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await repository.create(workOrder);

      expect(result.id).toBe(workOrder.id);
      expect(prisma.workOrder.create).toHaveBeenCalled();
    });
  });

  describe('findById', () => {
    it('should return a work order when found (without services/partSupplies)', async () => {
      const id = randomUUID();
      prisma.workOrder.findUnique.mockResolvedValue({ id, number: '000001' });

      const result = await repository.findById(id);

      expect(result).toBeDefined();
      expect(result?.id).toBe(id);
      expect(prisma.workOrder.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id },
          include: expect.not.objectContaining({ services: expect.anything() }),
        }),
      );
    });

    it('should return null when not found', async () => {
      prisma.workOrder.findUnique.mockResolvedValue(null);
      const result = await repository.findById(randomUUID());
      expect(result).toBeNull();
    });
  });

  describe('findByCustomerId', () => {
    it('should find the work orders of a customer without relations and return domain entities', async () => {
      const customerId = randomUUID();
      const ids = [randomUUID(), randomUUID()];
      prisma.workOrder.findMany.mockResolvedValue([
        { id: ids[0], number: '000001', customerId },
        { id: ids[1], number: '000002', customerId },
      ]);

      const result = await repository.findByCustomerId(customerId);

      expect(result).toHaveLength(2);
      expect(result[0]).toBeInstanceOf(WorkOrder);
      expect(result[0].id).toBe(ids[0]);
      expect(result[1].id).toBe(ids[1]);
      expect(prisma.workOrder.findMany).toHaveBeenCalledWith({ where: { customerId } });
    });
  });

  describe('findByVehicleId', () => {
    it('should find the work orders of a vehicle without relations and return domain entities', async () => {
      const vehicleId = randomUUID();
      const ids = [randomUUID(), randomUUID()];
      prisma.workOrder.findMany.mockResolvedValue([
        { id: ids[0], number: '000001', vehicleId },
        { id: ids[1], number: '000002', vehicleId },
      ]);

      const result = await repository.findByVehicleId(vehicleId);

      expect(result).toHaveLength(2);
      expect(result[0]).toBeInstanceOf(WorkOrder);
      expect(result[0].id).toBe(ids[0]);
      expect(result[1].id).toBe(ids[1]);
      expect(prisma.workOrder.findMany).toHaveBeenCalledWith({ where: { vehicleId } });
    });
  });

  describe('findByIdWithDetails', () => {
    it('should return a work order with relations when found', async () => {
      const id = randomUUID();
      prisma.workOrder.findUnique.mockResolvedValue({ id, number: '000001' });

      const result = await repository.findByIdWithDetails(id);

      expect(result).toBeDefined();
      expect(result?.id).toBe(id);
      expect(prisma.workOrder.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id },
          include: expect.objectContaining({ services: expect.anything() }),
        }),
      );
    });

    it('should return null when not found', async () => {
      prisma.workOrder.findUnique.mockResolvedValue(null);
      const result = await repository.findByIdWithDetails(randomUUID());
      expect(result).toBeNull();
    });
  });

  describe('findAllPaginated', () => {
    it('should return paginated work orders without filters', async () => {
      const id1 = randomUUID();
      const id2 = randomUUID();
      prisma.workOrder.findMany.mockResolvedValue([
        { id: id1, number: '000001', status: WorkOrderStatus.IN_PROGRESS, createdAt: new Date() },
        { id: id2, number: '000002', status: WorkOrderStatus.RECEIVED, createdAt: new Date() },
      ]);
      prisma.workOrder.count.mockResolvedValue(2);

      const result = await repository.findAllPaginated({ page: 3, limit: 5 }, {});

      expect(result.total).toBe(2);
      expect(result.items[0]).toMatchObject({ id: id1 });
      expect(result.items[1]).toMatchObject({ id: id2 });
      expect(prisma.workOrder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 10, take: 5 }),
      );
      expect(prisma.workOrder.count).toHaveBeenCalled();
    });

    it('should filter by customerId', async () => {
      const customerId = randomUUID();
      prisma.workOrder.findMany.mockResolvedValue([]);
      prisma.workOrder.count.mockResolvedValue(0);

      await repository.findAllPaginated({ page: 1, limit: 10 }, { customerId });

      expect(prisma.workOrder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ customerId }) }),
      );
    });

    it('should filter by a set of customer ids when customerIdIn is provided', async () => {
      prisma.workOrder.findMany.mockResolvedValue([]);
      prisma.workOrder.count.mockResolvedValue(0);
      const ids = [randomUUID(), randomUUID()];

      await repository.findAllPaginated({ page: 1, limit: 10 }, { customerIdIn: ids });

      expect(prisma.workOrder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { customerId: { in: ids } } }),
      );
    });

    it('should filter to zero results when customerIdIn is an empty array, not skip the filter', async () => {
      prisma.workOrder.findMany.mockResolvedValue([]);
      prisma.workOrder.count.mockResolvedValue(0);

      await repository.findAllPaginated({ page: 1, limit: 10 }, { customerIdIn: [] });

      expect(prisma.workOrder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { customerId: { in: [] } } }),
      );
    });

    it('should filter by vehicleId', async () => {
      const vehicleId = randomUUID();
      prisma.workOrder.findMany.mockResolvedValue([]);
      prisma.workOrder.count.mockResolvedValue(0);

      await repository.findAllPaginated({ page: 1, limit: 10 }, { vehicleId });

      expect(prisma.workOrder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ vehicleId }) }),
      );
    });

    it('should filter by number', async () => {
      const number = '000001';
      prisma.workOrder.findMany.mockResolvedValue([]);
      prisma.workOrder.count.mockResolvedValue(0);

      await repository.findAllPaginated({ page: 1, limit: 10 }, { number });

      expect(prisma.workOrder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ number: { contains: number, mode: 'insensitive' } }),
        }),
      );
    });

    it('should filter by assignedUserId', async () => {
      const assignedUserId = randomUUID();
      prisma.workOrder.findMany.mockResolvedValue([]);
      prisma.workOrder.count.mockResolvedValue(0);

      await repository.findAllPaginated({ page: 1, limit: 10 }, { assignedUserId });

      expect(prisma.workOrder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ assignedUserId }) }),
      );
    });

    it('should pass orderBy status:desc as statusInfo.priority desc to findMany', async () => {
      prisma.workOrder.findMany.mockResolvedValue([]);
      prisma.workOrder.count.mockResolvedValue(0);

      await repository.findAllPaginated({ page: 1, limit: 10 }, {}, [
        { field: 'status', direction: SortDirection.DESC },
        { field: 'createdAt', direction: SortDirection.ASC },
      ]);

      expect(prisma.workOrder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [{ statusInfo: { priority: 'desc' } }, { createdAt: 'asc' }],
        }),
      );
    });

    it('should pass orderBy status:asc as statusInfo.priority asc to findMany', async () => {
      prisma.workOrder.findMany.mockResolvedValue([]);
      prisma.workOrder.count.mockResolvedValue(0);

      await repository.findAllPaginated({ page: 1, limit: 10 }, {}, [
        { field: 'status', direction: SortDirection.ASC },
      ]);

      expect(prisma.workOrder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [{ statusInfo: { priority: 'asc' } }],
        }),
      );
    });

    it('should apply statusNotIn as { notIn: [...] }', async () => {
      prisma.workOrder.findMany.mockResolvedValue([]);
      prisma.workOrder.count.mockResolvedValue(0);

      await repository.findAllPaginated(
        { page: 1, limit: 10 },
        {
          statusNotIn: [
            WorkOrderStatus.COMPLETED,
            WorkOrderStatus.DELIVERED,
            WorkOrderStatus.CANCELLED,
          ],
        },
      );

      expect(prisma.workOrder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: {
              notIn: [
                WorkOrderStatus.COMPLETED,
                WorkOrderStatus.DELIVERED,
                WorkOrderStatus.CANCELLED,
              ],
            },
          }),
        }),
      );
    });

    it('should give precedence to explicit status over statusNotIn', async () => {
      prisma.workOrder.findMany.mockResolvedValue([]);
      prisma.workOrder.count.mockResolvedValue(0);

      await repository.findAllPaginated(
        { page: 1, limit: 10 },
        {
          status: WorkOrderStatus.DELIVERED,
          statusNotIn: [WorkOrderStatus.COMPLETED, WorkOrderStatus.CANCELLED],
        },
      );

      expect(prisma.workOrder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: WorkOrderStatus.DELIVERED }),
        }),
      );
      const [call] = prisma.workOrder.findMany.mock.calls;
      expect((call[0] as { where: Record<string, unknown> }).where.status).toBe(
        WorkOrderStatus.DELIVERED,
      );
    });

    it('should leave where.status undefined when neither status nor statusNotIn provided', async () => {
      prisma.workOrder.findMany.mockResolvedValue([]);
      prisma.workOrder.count.mockResolvedValue(0);

      await repository.findAllPaginated({ page: 1, limit: 10 }, {});

      const [call] = prisma.workOrder.findMany.mock.calls;
      expect((call[0] as { where: Record<string, unknown> }).where.status).toBeUndefined();
    });
  });

  describe('update', () => {
    it('should update a work order using optimistic locking', async () => {
      const workOrder = WorkOrder.reconstitute({
        id: randomUUID(),
        number: WorkOrderNumber.create('001'),
        customerId: randomUUID(),
        vehicleId: randomUUID(),
        assignedUserId: randomUUID(),
        status: WorkOrderStatus.COMPLETED,
        problemDescription: 'Problem',
        internalNotes: 'Notes',
        mileageAtService: 50000,
        totalAmount: 500,
        version: 1,
        approvedAt: new Date(),
        rejectedAt: null,
        startedAt: new Date(),
        finishedAt: new Date(),
        deliveredAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      prisma.workOrder.update.mockResolvedValue({
        ...workOrder,
        number: workOrder.number.toString(),
        status: workOrder.status,
        totalAmount: workOrder.totalAmount,
        version: 2,
      });

      const result = await repository.update(workOrder);

      expect(result.status).toBe(WorkOrderStatus.COMPLETED);
      expect(prisma.workOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: workOrder.id, version: 1 } }),
      );
    });

    it('should throw ConcurrencyException when work order was modified concurrently', async () => {
      const workOrder = WorkOrder.reconstitute({
        id: randomUUID(),
        number: WorkOrderNumber.create('001'),
        customerId: randomUUID(),
        vehicleId: randomUUID(),
        assignedUserId: null,
        status: WorkOrderStatus.RECEIVED,
        problemDescription: null,
        internalNotes: null,
        mileageAtService: null,
        totalAmount: 0,
        version: 1,
        approvedAt: null,
        rejectedAt: null,
        startedAt: null,
        finishedAt: null,
        deliveredAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      prisma.workOrder.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Record not found', {
          code: 'P2025',
          clientVersion: '7.0.0',
        }),
      );

      await expect(repository.update(workOrder)).rejects.toThrow(ConcurrencyException);
    });

    it('should rethrow unexpected errors from update', async () => {
      const workOrder = WorkOrder.reconstitute({
        id: randomUUID(),
        number: WorkOrderNumber.create('001'),
        customerId: randomUUID(),
        vehicleId: randomUUID(),
        assignedUserId: null,
        status: WorkOrderStatus.RECEIVED,
        problemDescription: null,
        internalNotes: null,
        mileageAtService: null,
        totalAmount: 0,
        version: 1,
        approvedAt: null,
        rejectedAt: null,
        startedAt: null,
        finishedAt: null,
        deliveredAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      prisma.workOrder.update.mockRejectedValue(new Error('Database connection lost'));

      await expect(repository.update(workOrder)).rejects.toThrow('Database connection lost');
    });
  });

  describe('generateNextNumber', () => {
    it('should return the raw sequence value (no padding — that is the VO concern)', async () => {
      prisma.$queryRaw.mockResolvedValue([{ next: 1n }]);

      const result = await repository.generateNextNumber();

      expect(result).toBe('1');
      expect(prisma.$queryRaw).toHaveBeenCalled();
    });

    it('should return larger sequence values unpadded', async () => {
      prisma.$queryRaw.mockResolvedValue([{ next: 42n }]);

      const result = await repository.generateNextNumber();

      expect(result).toBe('42');
    });
  });

  describe('addServiceItems', () => {
    it('should call workOrderService.createMany with mapped data', async () => {
      const workOrder = WorkOrder.create({
        number: '000001',
        customerId: randomUUID(),
        vehicleId: randomUUID(),
      });
      const item = WorkOrderService.create({
        workOrderId: workOrder.id,
        serviceId: randomUUID(),
        quantity: 1,
        unitPrice: 100,
      });

      prisma.workOrderService.createMany.mockResolvedValue({ count: 1 });

      await repository.addServiceItems([item]);

      expect(prisma.workOrderService.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([expect.objectContaining({ workOrderId: workOrder.id })]),
        }),
      );
    });

    it('should throw ResourceConflictException on P2002 (duplicate service item)', async () => {
      const workOrder = WorkOrder.create({
        number: '000001',
        customerId: randomUUID(),
        vehicleId: randomUUID(),
      });
      const item = WorkOrderService.create({
        workOrderId: workOrder.id,
        serviceId: randomUUID(),
        quantity: 1,
        unitPrice: 100,
      });

      prisma.workOrderService.createMany.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: '7.0.0',
        }),
      );

      await expect(repository.addServiceItems([item])).rejects.toThrow(ResourceConflictException);
    });

    it('should rethrow unexpected errors from addServiceItems', async () => {
      const workOrder = WorkOrder.create({
        number: '000001',
        customerId: randomUUID(),
        vehicleId: randomUUID(),
      });
      const item = WorkOrderService.create({
        workOrderId: workOrder.id,
        serviceId: randomUUID(),
        quantity: 1,
        unitPrice: 100,
      });

      prisma.workOrderService.createMany.mockRejectedValue(new Error('Database connection lost'));

      await expect(repository.addServiceItems([item])).rejects.toThrow('Database connection lost');
    });
  });

  describe('updateServiceItemStatus', () => {
    it('should update the service item and then the work order with the version check, without a nested $transaction', async () => {
      const workOrderId = randomUUID();
      const serviceId = randomUUID();
      const workOrder = WorkOrder.reconstitute({
        id: workOrderId,
        number: WorkOrderNumber.create('000001'),
        customerId: randomUUID(),
        vehicleId: randomUUID(),
        assignedUserId: null,
        status: WorkOrderStatus.IN_PROGRESS,
        problemDescription: null,
        internalNotes: null,
        mileageAtService: null,
        totalAmount: 0,
        version: 2,
        approvedAt: null,
        rejectedAt: null,
        startedAt: new Date(),
        finishedAt: null,
        deliveredAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const item = WorkOrderService.create({
        workOrderId,
        serviceId,
        quantity: 1,
        unitPrice: 100,
      });
      item.startService();

      prisma.workOrderService.update.mockResolvedValue({});
      prisma.workOrder.update.mockResolvedValue({});

      await repository.updateServiceItemStatus(workOrder, item);

      expect(prisma.workOrderService.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            workOrderId_serviceId: expect.objectContaining({ serviceId }),
          }),
          data: expect.objectContaining({ status: item.status }),
        }),
      );
      expect(prisma.workOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: workOrderId, version: 2 },
          data: expect.objectContaining({ version: { increment: 1 } }),
        }),
      );
      expect(prisma.workOrderService.update.mock.invocationCallOrder[0]).toBeLessThan(
        prisma.workOrder.update.mock.invocationCallOrder[0],
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('should throw ConcurrencyException on P2025 during atomic update', async () => {
      const workOrderId = randomUUID();
      const workOrder = WorkOrder.reconstitute({
        id: workOrderId,
        number: WorkOrderNumber.create('000001'),
        customerId: randomUUID(),
        vehicleId: randomUUID(),
        assignedUserId: null,
        status: WorkOrderStatus.IN_PROGRESS,
        problemDescription: null,
        internalNotes: null,
        mileageAtService: null,
        totalAmount: 0,
        version: 1,
        approvedAt: null,
        rejectedAt: null,
        startedAt: null,
        finishedAt: null,
        deliveredAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const item = WorkOrderService.create({
        workOrderId,
        serviceId: randomUUID(),
        quantity: 1,
        unitPrice: 100,
      });

      prisma.workOrder.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Record not found', {
          code: 'P2025',
          clientVersion: '5.0.0',
        }),
      );
      prisma.workOrderService.update.mockResolvedValue({});

      await expect(repository.updateServiceItemStatus(workOrder, item)).rejects.toThrow(
        ConcurrencyException,
      );
    });

    it('should rethrow unexpected errors from atomic update', async () => {
      const workOrderId = randomUUID();
      const workOrder = WorkOrder.reconstitute({
        id: workOrderId,
        number: WorkOrderNumber.create('000001'),
        customerId: randomUUID(),
        vehicleId: randomUUID(),
        assignedUserId: null,
        status: WorkOrderStatus.IN_PROGRESS,
        problemDescription: null,
        internalNotes: null,
        mileageAtService: null,
        totalAmount: 0,
        version: 1,
        approvedAt: null,
        rejectedAt: null,
        startedAt: null,
        finishedAt: null,
        deliveredAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const item = WorkOrderService.create({
        workOrderId,
        serviceId: randomUUID(),
        quantity: 1,
        unitPrice: 100,
      });

      prisma.workOrderService.update.mockRejectedValue(new Error('Unexpected DB error'));
      prisma.workOrder.update.mockResolvedValue({});

      await expect(repository.updateServiceItemStatus(workOrder, item)).rejects.toThrow(
        'Unexpected DB error',
      );
    });
  });

  describe('addPartSupplyItems', () => {
    it('should call workOrderPartSupply.createMany with mapped data', async () => {
      const workOrder = WorkOrder.create({
        number: '000001',
        customerId: randomUUID(),
        vehicleId: randomUUID(),
      });
      const item = WorkOrderPartSupply.create({
        workOrderId: workOrder.id,
        partSupplyId: randomUUID(),
        quantity: 2,
        unitPrice: 50,
      });

      prisma.workOrderPartSupply.createMany.mockResolvedValue({ count: 1 });

      await repository.addPartSupplyItems([item]);

      expect(prisma.workOrderPartSupply.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([expect.objectContaining({ workOrderId: workOrder.id })]),
        }),
      );
    });

    it('should throw ResourceConflictException on P2002 (duplicate part supply item)', async () => {
      const workOrder = WorkOrder.create({
        number: '000001',
        customerId: randomUUID(),
        vehicleId: randomUUID(),
      });
      const item = WorkOrderPartSupply.create({
        workOrderId: workOrder.id,
        partSupplyId: randomUUID(),
        quantity: 2,
        unitPrice: 50,
      });

      prisma.workOrderPartSupply.createMany.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: '7.0.0',
        }),
      );

      await expect(repository.addPartSupplyItems([item])).rejects.toThrow(
        ResourceConflictException,
      );
    });

    it('should rethrow unexpected errors from addPartSupplyItems', async () => {
      const workOrder = WorkOrder.create({
        number: '000001',
        customerId: randomUUID(),
        vehicleId: randomUUID(),
      });
      const item = WorkOrderPartSupply.create({
        workOrderId: workOrder.id,
        partSupplyId: randomUUID(),
        quantity: 2,
        unitPrice: 50,
      });

      prisma.workOrderPartSupply.createMany.mockRejectedValue(
        new Error('Database connection lost'),
      );

      await expect(repository.addPartSupplyItems([item])).rejects.toThrow(
        'Database connection lost',
      );
    });
  });
});
