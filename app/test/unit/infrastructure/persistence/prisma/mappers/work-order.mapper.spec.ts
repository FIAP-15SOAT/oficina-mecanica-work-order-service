import { randomUUID } from 'node:crypto';
import { Prisma } from '@generated/client';

import { WorkOrderMapper } from '@infrastructure/persistence/prisma/mappers/work-order.mapper';

import { WorkOrderStatus } from '@domain/enums/work-order-status.enum';
import { WorkOrderServiceStatus } from '@domain/enums/work-order-service-status.enum';
import { CustomerType } from '@domain/enums/customer-type.enum';

describe('WorkOrderMapper', () => {
  describe('toDomain', () => {
    it('should map a Prisma record to a domain entity', () => {
      const now = new Date();
      const prismaRecord = {
        id: randomUUID(),
        number: '000001',
        customerId: randomUUID(),
        vehicleId: randomUUID(),
        assignedUserId: randomUUID(),
        status: WorkOrderStatus.IN_DIAGNOSIS,
        problemDescription: 'Engine noise',
        internalNotes: 'Check timing belt',
        mileageAtService: 50000,
        totalAmount: new Prisma.Decimal(250.0),
        version: 0,
        approvedAt: now,
        rejectedAt: null,
        startedAt: now,
        finishedAt: null,
        deliveredAt: null,
        createdAt: now,
        updatedAt: now,
      };

      const domainEntity = WorkOrderMapper.toDomain(prismaRecord);

      expect(domainEntity.id).toBe(prismaRecord.id);
      expect(domainEntity.number.toString()).toBe(prismaRecord.number);
      expect(domainEntity.customerId).toBe(prismaRecord.customerId);
      expect(domainEntity.vehicleId).toBe(prismaRecord.vehicleId);
      expect(domainEntity.assignedUserId).toBe(prismaRecord.assignedUserId);
      expect(domainEntity.status).toBe(WorkOrderStatus.IN_DIAGNOSIS);
      expect(domainEntity.problemDescription).toBe(prismaRecord.problemDescription);
      expect(domainEntity.internalNotes).toBe(prismaRecord.internalNotes);
      expect(domainEntity.mileageAtService).toBe(prismaRecord.mileageAtService);
      expect(domainEntity.totalAmount).toBe(250.0);
      expect(domainEntity.approvedAt).toBe(prismaRecord.approvedAt);
      expect(domainEntity.rejectedAt).toBeNull();
      expect(domainEntity.startedAt).toBe(prismaRecord.startedAt);
      expect(domainEntity.finishedAt).toBeNull();
      expect(domainEntity.deliveredAt).toBeNull();
      expect(domainEntity.createdAt).toBe(prismaRecord.createdAt);
      expect(domainEntity.updatedAt).toBe(prismaRecord.updatedAt);
    });

    it('should map a Prisma record with nulls to a domain entity', () => {
      const now = new Date();
      const prismaRecord = {
        id: randomUUID(),
        number: '000001',
        customerId: randomUUID(),
        vehicleId: randomUUID(),
        assignedUserId: null,
        status: WorkOrderStatus.RECEIVED,
        problemDescription: null,
        internalNotes: null,
        mileageAtService: null,
        totalAmount: new Prisma.Decimal(0.0),
        version: 0,
        approvedAt: null,
        rejectedAt: null,
        startedAt: null,
        finishedAt: null,
        deliveredAt: null,
        createdAt: now,
        updatedAt: now,
      };

      const domainEntity = WorkOrderMapper.toDomain(prismaRecord);

      expect(domainEntity.assignedUserId).toBeNull();
      expect(domainEntity.problemDescription).toBeNull();
      expect(domainEntity.internalNotes).toBeNull();
      expect(domainEntity.mileageAtService).toBeNull();
      expect(domainEntity.totalAmount).toBe(0);
      expect(domainEntity.approvedAt).toBeNull();
      expect(domainEntity.startedAt).toBeNull();
    });

    it('should map all nested relations when present', () => {
      const now = new Date();
      const customerId = randomUUID();
      const vehicleId = randomUUID();
      const userId = randomUUID();
      const serviceId = randomUUID();
      const partSupplyId = randomUUID();
      const prismaRecord = {
        id: randomUUID(),
        number: '000003',
        customerId,
        vehicleId,
        assignedUserId: userId,
        status: WorkOrderStatus.IN_PROGRESS,
        problemDescription: null,
        internalNotes: null,
        mileageAtService: null,
        totalAmount: new Prisma.Decimal(300),
        version: 0,
        approvedAt: now,
        rejectedAt: null,
        startedAt: now,
        finishedAt: null,
        deliveredAt: null,
        createdAt: now,
        updatedAt: now,
        customer: {
          id: customerId,
          name: 'Maria Silva',
          document: '98765432100',
          type: CustomerType.INDIVIDUAL,
          email: 'maria@test.com',
          phone: '11988887777',
          address: null,
          createdAt: now,
          updatedAt: now,
          isActive: true,
        },
        vehicle: {
          id: vehicleId,
          customerId,
          plate: 'XYZ-9876',
          brand: 'Honda',
          model: 'Civic',
          year: 2021,
          color: 'Preto',
          mileage: 30000,
          version: 0,
          createdAt: now,
          updatedAt: now,
        },
        services: [
          {
            workOrderId: randomUUID(),
            serviceId,
            quantity: 1,
            unitPrice: new Prisma.Decimal(150),
            totalPrice: new Prisma.Decimal(150),
            status: WorkOrderServiceStatus.PENDING,
            startedAt: null,
            finishedAt: null,
            createdAt: now,
            updatedAt: now,
          },
        ],
        partSupplies: [
          {
            workOrderId: randomUUID(),
            partSupplyId,
            quantity: 2,
            unitPrice: new Prisma.Decimal(30),
            totalPrice: new Prisma.Decimal(60),
            createdAt: now,
            updatedAt: now,
          },
        ],
      };

      const domainEntity = WorkOrderMapper.toDomain(prismaRecord);

      expect(domainEntity.customer).toBeDefined();
      expect(domainEntity.customer!.id).toBe(customerId);
      expect(domainEntity.vehicle).toBeDefined();
      expect(domainEntity.vehicle!.id).toBe(vehicleId);
      expect(domainEntity.assignedUserId).toBe(userId);
      expect(domainEntity.services).toHaveLength(1);
      expect(domainEntity.services[0].serviceId).toBe(serviceId);
      expect(domainEntity.partSupplies).toHaveLength(1);
      expect(domainEntity.partSupplies[0].partSupplyId).toBe(partSupplyId);
    });
  });
});
