import { randomUUID } from 'node:crypto';
import { Prisma } from '@generated/client';

import { WorkOrderServiceMapper } from '@infrastructure/persistence/prisma/mappers/work-order-service.mapper';
import { WorkOrderServiceStatus } from '@domain/enums/work-order-service-status.enum';

describe('WorkOrderServiceMapper', () => {
  describe('toDomain', () => {
    it('should map a Prisma record to a domain entity', () => {
      const now = new Date();
      const prismaRecord = {
        id: randomUUID(), // although mapper doesn't seem to map id explicitly in this version, let's include it
        workOrderId: randomUUID(),
        serviceId: randomUUID(),
        quantity: 2,
        unitPrice: new Prisma.Decimal(100.0),
        totalPrice: new Prisma.Decimal(200.0),
        status: WorkOrderServiceStatus.COMPLETED,
        startedAt: now,
        finishedAt: now,
        createdAt: now,
        updatedAt: now,
      };

      const domainEntity = WorkOrderServiceMapper.toDomain(prismaRecord);

      expect(domainEntity.workOrderId).toBe(prismaRecord.workOrderId);
      expect(domainEntity.serviceId).toBe(prismaRecord.serviceId);
      expect(domainEntity.quantity).toBe(prismaRecord.quantity);
      expect(domainEntity.unitPrice).toBe(100.0);
      expect(domainEntity.totalPrice).toBe(200.0);
      expect(domainEntity.status).toBe(WorkOrderServiceStatus.COMPLETED);
      expect(domainEntity.startedAt).toBe(prismaRecord.startedAt);
      expect(domainEntity.finishedAt).toBe(prismaRecord.finishedAt);
      expect(domainEntity.createdAt).toBe(prismaRecord.createdAt);
      expect(domainEntity.updatedAt).toBe(prismaRecord.updatedAt);
    });

    it('should map a Prisma record with nulls to a domain entity', () => {
      const now = new Date();
      const prismaRecord = {
        id: randomUUID(),
        workOrderId: randomUUID(),
        serviceId: randomUUID(),
        quantity: 2,
        unitPrice: new Prisma.Decimal(100.0),
        totalPrice: new Prisma.Decimal(200.0),
        status: WorkOrderServiceStatus.PENDING,
        startedAt: null,
        finishedAt: null,
        createdAt: now,
        updatedAt: now,
      };

      const domainEntity = WorkOrderServiceMapper.toDomain(prismaRecord);

      expect(domainEntity.startedAt).toBeNull();
      expect(domainEntity.finishedAt).toBeNull();
    });
  });
});
