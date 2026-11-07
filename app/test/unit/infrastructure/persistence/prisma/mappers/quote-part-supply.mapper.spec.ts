import { randomUUID } from 'node:crypto';

import { QuotePartSupplyMapper } from '@infrastructure/persistence/prisma/mappers/quote-part-supply.mapper';

import { Prisma } from '@generated/client';

describe('QuotePartSupplyMapper', () => {
  describe('toDomain', () => {
    it('should map a Prisma record to a domain entity', () => {
      const now = new Date();
      const prismaRecord = {
        quoteId: randomUUID(),
        partSupplyId: randomUUID(),
        quantity: 2,
        unitPrice: new Prisma.Decimal(50.0),
        totalPrice: new Prisma.Decimal(100.0),
        createdAt: now,
        updatedAt: now,
      };

      const domainEntity = QuotePartSupplyMapper.toDomain(prismaRecord);

      expect(domainEntity.quoteId).toBe(prismaRecord.quoteId);
      expect(domainEntity.partSupplyId).toBe(prismaRecord.partSupplyId);
      expect(domainEntity.quantity).toBe(prismaRecord.quantity);
      expect(domainEntity.unitPrice).toBe(50.0);
      expect(domainEntity.totalPrice).toBe(100.0);
      expect(domainEntity.createdAt).toBe(prismaRecord.createdAt);
      expect(domainEntity.updatedAt).toBe(prismaRecord.updatedAt);
    });
  });
});
