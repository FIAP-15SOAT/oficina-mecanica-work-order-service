import { Prisma } from '@generated/client';
import { randomUUID } from 'node:crypto';

import { WorkOrderPartSupplyMapper } from '@infrastructure/persistence/prisma/mappers/work-order-part-supply.mapper';

describe('WorkOrderPartSupplyMapper', () => {
  describe('toDomain', () => {
    it('should map a Prisma record to a domain entity', () => {
      const now = new Date();
      const prismaRecord = {
        workOrderId: randomUUID(),
        partSupplyId: randomUUID(),
        quantity: 2,
        unitPrice: new Prisma.Decimal(50.0),
        totalPrice: new Prisma.Decimal(100.0),
        createdAt: now,
        updatedAt: now,
      };

      const domainEntity = WorkOrderPartSupplyMapper.toDomain(prismaRecord);

      expect(domainEntity.workOrderId).toBe(prismaRecord.workOrderId);
      expect(domainEntity.partSupplyId).toBe(prismaRecord.partSupplyId);
      expect(domainEntity.quantity).toBe(2);
      expect(domainEntity.unitPrice).toBe(50.0);
      expect(domainEntity.totalPrice).toBe(100.0);
      expect(domainEntity.createdAt).toBe(prismaRecord.createdAt);
      expect(domainEntity.updatedAt).toBe(prismaRecord.updatedAt);
    });
  });
});
