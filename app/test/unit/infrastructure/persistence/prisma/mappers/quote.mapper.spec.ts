import { randomUUID } from 'node:crypto';
import { Prisma } from '@generated/client';

import { QuoteMapper } from '@infrastructure/persistence/prisma/mappers/quote.mapper';
import { QuoteStatus } from '@domain/enums/quote-status.enum';
import { WorkOrderStatus } from '@domain/enums/work-order-status.enum';

describe('QuoteMapper', () => {
  describe('toDomain', () => {
    it('should map a Prisma record to a domain entity', () => {
      const now = new Date();
      const prismaRecord = {
        id: randomUUID(),
        workOrderId: randomUUID(),
        servicesAmount: new Prisma.Decimal(150.0),
        partsAmount: new Prisma.Decimal(50.0),
        totalAmount: new Prisma.Decimal(200.0),
        status: QuoteStatus.PENDING,
        notes: 'Some notes',
        sentAt: now,
        approvedAt: null,
        rejectedAt: null,
        replacedByQuoteId: null,
        decidedBy: null,
        version: 0,
        createdAt: now,
        updatedAt: now,
      };

      const domainEntity = QuoteMapper.toDomain(prismaRecord);

      expect(domainEntity.id).toBe(prismaRecord.id);
      expect(domainEntity.workOrderId).toBe(prismaRecord.workOrderId);
      expect(domainEntity.servicesAmount).toBe(150.0);
      expect(domainEntity.partsAmount).toBe(50.0);
      expect(domainEntity.totalAmount).toBe(200.0);
      expect(domainEntity.status).toBe(QuoteStatus.PENDING);
      expect(domainEntity.notes).toBe(prismaRecord.notes);
      expect(domainEntity.sentAt).toBe(prismaRecord.sentAt);
      expect(domainEntity.approvedAt).toBeNull();
      expect(domainEntity.rejectedAt).toBeNull();
      expect(domainEntity.createdAt).toBe(prismaRecord.createdAt);
      expect(domainEntity.updatedAt).toBe(prismaRecord.updatedAt);
    });

    it('should map a Prisma record with services and parts to a domain entity', () => {
      const now = new Date();
      const quoteId = randomUUID();
      const prismaRecord = {
        id: quoteId,
        workOrderId: randomUUID(),
        servicesAmount: new Prisma.Decimal(100),
        partsAmount: new Prisma.Decimal(50),
        totalAmount: new Prisma.Decimal(150),
        status: QuoteStatus.SENT,
        notes: null,
        sentAt: now,
        approvedAt: null,
        rejectedAt: null,
        replacedByQuoteId: null,
        decidedBy: null,
        version: 0,
        createdAt: now,
        updatedAt: now,
        services: [
          {
            id: randomUUID(),
            quoteId,
            serviceId: randomUUID(),
            quantity: 1,
            unitPrice: new Prisma.Decimal(100),
            totalPrice: new Prisma.Decimal(100),
            createdAt: now,
            updatedAt: now,
          },
        ],
        partsSupplies: [
          {
            id: randomUUID(),
            quoteId,
            partSupplyId: randomUUID(),
            quantity: 2,
            unitPrice: new Prisma.Decimal(25),
            totalPrice: new Prisma.Decimal(50),
            createdAt: now,
            updatedAt: now,
          },
        ],
      };

      const domainEntity = QuoteMapper.toDomain(prismaRecord);

      expect(domainEntity.services).toHaveLength(1);
      expect(domainEntity.partsSupplies).toHaveLength(1);
      expect(domainEntity.services[0].unitPrice).toBe(100);
      expect(domainEntity.partsSupplies[0].unitPrice).toBe(25);
    });

    it('should enrich entity with workOrder relation when present', () => {
      const now = new Date();

      const prismaRecord = {
        id: randomUUID(),
        workOrderId: randomUUID(),
        servicesAmount: new Prisma.Decimal(0),
        partsAmount: new Prisma.Decimal(0),
        totalAmount: new Prisma.Decimal(0),
        status: QuoteStatus.PENDING,
        notes: null,
        sentAt: null,
        approvedAt: null,
        rejectedAt: null,
        replacedByQuoteId: null,
        decidedBy: null,
        version: 0,
        createdAt: now,
        updatedAt: now,
        workOrder: {
          id: randomUUID(),
          number: '000001',
          customerId: randomUUID(),
          vehicleId: randomUUID(),
          assignedUserId: null,
          status: WorkOrderStatus.IN_DIAGNOSIS,
          problemDescription: null,
          internalNotes: null,
          mileageAtService: null,
          totalAmount: new Prisma.Decimal(0),
          version: 0,
          approvedAt: null,
          rejectedAt: null,
          startedAt: null,
          finishedAt: null,
          deliveredAt: null,
          createdAt: now,
          updatedAt: now,
        },
      };

      const domainEntity = QuoteMapper.toDomain(prismaRecord);

      expect(domainEntity.workOrder).toBeDefined();
      expect(domainEntity.workOrder!.number.toString()).toBe('000001');
    });
  });
});
