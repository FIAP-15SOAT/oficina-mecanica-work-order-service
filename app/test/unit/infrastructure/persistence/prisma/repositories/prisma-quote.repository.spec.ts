import { randomUUID } from 'node:crypto';
import { Prisma } from '@generated/client';

import { PrismaQuoteRepository } from '@infrastructure/persistence/prisma/repositories/prisma-quote.repository';

import { Quote } from '@domain/entities/quote.entity';
import { QuoteService } from '@domain/entities/quote-service.entity';
import { QuotePartSupply } from '@domain/entities/quote-part-supply.entity';
import { QuoteStatus } from '@domain/enums/quote-status.enum';

import { ConcurrencyException } from '@infrastructure/exceptions/concurrency.exception';

import {
  createMockPrismaClient,
  MockPrismaService,
} from '../../../../../helpers/prisma-mock.factory';

describe('PrismaQuoteRepository', () => {
  let repository: PrismaQuoteRepository;
  let prisma: MockPrismaService;

  beforeEach(() => {
    prisma = createMockPrismaClient();
    repository = new PrismaQuoteRepository(prisma);
  });

  describe('create', () => {
    it('should create a quote with no items (empty nested create arrays)', async () => {
      const quote = Quote.create({
        workOrderId: randomUUID(),
        notes: 'Test notes',
      });

      prisma.quote.create.mockResolvedValue({
        id: quote.id,
        workOrderId: quote.workOrderId,
        servicesAmount: new Prisma.Decimal(quote.servicesAmount),
        partsAmount: new Prisma.Decimal(quote.partsAmount),
        totalAmount: new Prisma.Decimal(quote.totalAmount),
        status: quote.status,
        notes: quote.notes,
        sentAt: quote.sentAt,
        approvedAt: quote.approvedAt,
        rejectedAt: quote.rejectedAt,
        createdAt: quote.createdAt,
        updatedAt: quote.updatedAt,
        services: [],
        partsSupplies: [],
        workOrder: null,
      });

      const result = await repository.create(quote);

      expect(result.id).toBe(quote.id);
      expect(prisma.quote.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            services: { create: [] },
            partsSupplies: { create: [] },
          }),
          include: expect.objectContaining({
            services: true,
            partsSupplies: true,
            workOrder: expect.any(Object),
          }),
        }),
      );
    });

    it('should create quote with services and partsSupplies in a single nested create', async () => {
      const workOrderId = randomUUID();
      const serviceId = randomUUID();
      const partSupplyId = randomUUID();

      const quote = Quote.create({
        workOrderId,
        services: [{ serviceId, unitPrice: 100, quantity: 1 }],
        partsSupplies: [{ partSupplyId, unitPrice: 50, quantity: 2 }],
      });

      const mockRecord = {
        id: quote.id,
        workOrderId,
        servicesAmount: new Prisma.Decimal(100),
        partsAmount: new Prisma.Decimal(100),
        totalAmount: new Prisma.Decimal(200),
        status: quote.status,
        notes: null,
        sentAt: null,
        approvedAt: null,
        rejectedAt: null,
        createdAt: quote.createdAt,
        updatedAt: quote.updatedAt,
        services: [
          {
            quoteId: quote.id,
            serviceId,
            quantity: 1,
            unitPrice: new Prisma.Decimal(100),
            totalPrice: new Prisma.Decimal(100),
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
        partsSupplies: [
          {
            quoteId: quote.id,
            partSupplyId,
            quantity: 2,
            unitPrice: new Prisma.Decimal(50),
            totalPrice: new Prisma.Decimal(100),
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
        workOrder: null,
      };

      prisma.quote.create.mockResolvedValue(mockRecord);

      const result = await repository.create(quote);

      expect(result.services).toHaveLength(1);
      expect(result.partsSupplies).toHaveLength(1);
      expect(result.servicesAmount).toBe(100);
      expect(result.partsAmount).toBe(100);
      expect(result.totalAmount).toBe(200);
      expect(prisma.quote.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            services: { create: expect.any(Array) },
            partsSupplies: { create: expect.any(Array) },
          }),
          include: expect.objectContaining({
            services: true,
            partsSupplies: true,
          }),
        }),
      );
    });
  });

  describe('findById', () => {
    it('should return a quote without services (minimal) when found', async () => {
      const id = randomUUID();
      prisma.quote.findUnique.mockResolvedValue({
        id,
        status: QuoteStatus.PENDING,
        servicesAmount: new Prisma.Decimal(0),
        partsAmount: new Prisma.Decimal(0),
        totalAmount: new Prisma.Decimal(0),
      });

      const result = await repository.findById(id);

      expect(result).toBeDefined();
      expect(result?.id).toBe(id);
      expect(prisma.quote.findUnique).toHaveBeenCalledWith({ where: { id } });
    });

    it('should return null when not found', async () => {
      prisma.quote.findUnique.mockResolvedValue(null);

      const result = await repository.findById(randomUUID());

      expect(result).toBeNull();
    });
  });

  describe('findByIdWithDetails', () => {
    it('should return a quote with services, partsSupplies, and workOrder when found', async () => {
      const id = randomUUID();
      prisma.quote.findUnique.mockResolvedValue({
        id,
        status: QuoteStatus.PENDING,
        servicesAmount: new Prisma.Decimal(0),
        partsAmount: new Prisma.Decimal(0),
        totalAmount: new Prisma.Decimal(0),
        services: [],
        partsSupplies: [],
        workOrder: null,
      });

      const result = await repository.findByIdWithDetails(id);

      expect(result).toBeDefined();
      expect(result?.id).toBe(id);
      expect(prisma.quote.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id },
          include: expect.objectContaining({
            services: true,
            partsSupplies: true,
            workOrder: expect.objectContaining({ include: expect.any(Object) }),
          }),
        }),
      );
    });

    it('should return null when not found', async () => {
      prisma.quote.findUnique.mockResolvedValue(null);
      const result = await repository.findByIdWithDetails(randomUUID());
      expect(result).toBeNull();
    });
  });

  describe('update', () => {
    it('should update a quote using optimistic locking', async () => {
      const id = randomUUID();

      const quote = Quote.reconstitute({
        id,
        workOrderId: randomUUID(),
        servicesAmount: 0,
        partsAmount: 0,
        totalAmount: 0,
        status: QuoteStatus.SENT,
        notes: null,
        sentAt: null,
        approvedAt: null,
        rejectedAt: null,
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      prisma.quote.update.mockResolvedValue({
        id: quote.id,
        workOrderId: quote.workOrderId,
        servicesAmount: new Prisma.Decimal(quote.servicesAmount),
        partsAmount: new Prisma.Decimal(quote.partsAmount),
        totalAmount: new Prisma.Decimal(quote.totalAmount),
        status: quote.status,
        notes: quote.notes,
        sentAt: quote.sentAt,
        approvedAt: quote.approvedAt,
        rejectedAt: quote.rejectedAt,
        version: 2,
        createdAt: quote.createdAt,
        updatedAt: quote.updatedAt,
        workOrder: null,
      });

      const result = await repository.update(quote);

      expect(result.status).toBe(QuoteStatus.SENT);
      expect(prisma.quote.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: quote.id, version: 1 },
          include: expect.objectContaining({
            workOrder: expect.any(Object),
          }),
        }),
      );
    });

    it('should throw ConcurrencyException when quote was modified concurrently', async () => {
      const quote = Quote.reconstitute({
        id: randomUUID(),
        workOrderId: randomUUID(),
        servicesAmount: 0,
        partsAmount: 0,
        totalAmount: 0,
        status: QuoteStatus.PENDING,
        notes: null,
        sentAt: null,
        approvedAt: null,
        rejectedAt: null,
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      prisma.quote.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Record not found', {
          code: 'P2025',
          clientVersion: '7.0.0',
        }),
      );

      await expect(repository.update(quote)).rejects.toThrow(ConcurrencyException);
    });

    it('should rethrow unexpected errors from update', async () => {
      const quote = Quote.reconstitute({
        id: randomUUID(),
        workOrderId: randomUUID(),
        servicesAmount: 0,
        partsAmount: 0,
        totalAmount: 0,
        status: QuoteStatus.PENDING,
        notes: null,
        sentAt: null,
        approvedAt: null,
        rejectedAt: null,
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      prisma.quote.update.mockRejectedValue(new Error('Database connection lost'));

      await expect(repository.update(quote)).rejects.toThrow('Database connection lost');
    });
  });

  describe('findByWorkOrderId', () => {
    it('should return quotes for a work order with workOrder included', async () => {
      prisma.quote.findMany.mockResolvedValue([
        {
          id: randomUUID(),
          status: QuoteStatus.PENDING,
          servicesAmount: new Prisma.Decimal(0),
          partsAmount: new Prisma.Decimal(0),
          totalAmount: new Prisma.Decimal(0),
          workOrder: null,
        },
      ]);

      const workOrderId = randomUUID();
      const result = await repository.findByWorkOrderId(workOrderId);

      expect(result).toHaveLength(1);
      expect(prisma.quote.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { workOrderId },
          include: expect.objectContaining({ workOrder: expect.any(Object) }),
        }),
      );
    });
  });

  describe('rejectPendingByWorkOrderId', () => {
    it('should update pending quotes to rejected', async () => {
      prisma.quote.updateMany.mockResolvedValue({ count: 1 });

      await repository.rejectPendingByWorkOrderId(randomUUID());

      expect(prisma.quote.updateMany).toHaveBeenCalled();
    });
  });

  describe('addServiceItem', () => {
    it('should create a quoteService record and update quote totals', async () => {
      const quote = Quote.reconstitute({
        id: randomUUID(),
        workOrderId: randomUUID(),
        servicesAmount: 100,
        partsAmount: 0,
        totalAmount: 100,
        status: QuoteStatus.PENDING,
        notes: null,
        sentAt: null,
        approvedAt: null,
        rejectedAt: null,
        version: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      prisma.quoteService.create.mockResolvedValue({});
      prisma.quote.update.mockResolvedValue({});

      const item = QuoteService.reconstitute({
        quoteId: quote.id,
        serviceId: randomUUID(),
        quantity: 1,
        unitPrice: 100,
        totalPrice: 100,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await repository.addServiceItem(item);

      expect(prisma.quoteService.create).toHaveBeenCalled();
    });
  });

  describe('removeServiceItem', () => {
    it('should delete the quoteService record and update quote totals', async () => {
      const quote = Quote.reconstitute({
        id: randomUUID(),
        workOrderId: randomUUID(),
        servicesAmount: 0,
        partsAmount: 0,
        totalAmount: 0,
        status: QuoteStatus.PENDING,
        notes: null,
        sentAt: null,
        approvedAt: null,
        rejectedAt: null,
        version: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const serviceId = randomUUID();
      prisma.quoteService.delete.mockResolvedValue({});
      prisma.quote.update.mockResolvedValue({});

      await repository.removeServiceItem(quote.id, serviceId);

      expect(prisma.quoteService.delete).toHaveBeenCalled();
    });
  });

  describe('updateServiceItemQuantity', () => {
    it('should update the quoteService record and update quote totals', async () => {
      const quote = Quote.reconstitute({
        id: randomUUID(),
        workOrderId: randomUUID(),
        servicesAmount: 200,
        partsAmount: 0,
        totalAmount: 200,
        status: QuoteStatus.PENDING,
        notes: null,
        sentAt: null,
        approvedAt: null,
        rejectedAt: null,
        version: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      prisma.quoteService.update.mockResolvedValue({});
      prisma.quote.update.mockResolvedValue({});

      const item = QuoteService.reconstitute({
        quoteId: quote.id,
        serviceId: randomUUID(),
        quantity: 2,
        unitPrice: 100,
        totalPrice: 200,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await repository.updateServiceItemQuantity(item);

      expect(prisma.quoteService.update).toHaveBeenCalled();
    });
  });

  describe('addPartSupplyItem', () => {
    it('should create a quotePartSupply record and update quote totals', async () => {
      const quote = Quote.reconstitute({
        id: randomUUID(),
        workOrderId: randomUUID(),
        servicesAmount: 0,
        partsAmount: 80,
        totalAmount: 80,
        status: QuoteStatus.PENDING,
        notes: null,
        sentAt: null,
        approvedAt: null,
        rejectedAt: null,
        version: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      prisma.quotePartSupply.create.mockResolvedValue({});
      prisma.quote.update.mockResolvedValue({});

      const item = QuotePartSupply.reconstitute({
        quoteId: quote.id,
        partSupplyId: randomUUID(),
        quantity: 2,
        unitPrice: 40,
        totalPrice: 80,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await repository.addPartSupplyItem(item);

      expect(prisma.quotePartSupply.create).toHaveBeenCalled();
    });
  });

  describe('removePartSupplyItem', () => {
    it('should delete the quotePartSupply record and update quote totals', async () => {
      const quote = Quote.reconstitute({
        id: randomUUID(),
        workOrderId: randomUUID(),
        servicesAmount: 0,
        partsAmount: 0,
        totalAmount: 0,
        status: QuoteStatus.PENDING,
        notes: null,
        sentAt: null,
        approvedAt: null,
        rejectedAt: null,
        version: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const partSupplyId = randomUUID();
      prisma.quotePartSupply.delete.mockResolvedValue({});
      prisma.quote.update.mockResolvedValue({});

      await repository.removePartSupplyItem(quote.id, partSupplyId);

      expect(prisma.quotePartSupply.delete).toHaveBeenCalled();
    });
  });

  describe('updatePartSupplyItemQuantity', () => {
    it('should update the quotePartSupply record and update quote totals', async () => {
      const quote = Quote.reconstitute({
        id: randomUUID(),
        workOrderId: randomUUID(),
        servicesAmount: 0,
        partsAmount: 160,
        totalAmount: 160,
        status: QuoteStatus.PENDING,
        notes: null,
        sentAt: null,
        approvedAt: null,
        rejectedAt: null,
        version: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      prisma.quotePartSupply.update.mockResolvedValue({});
      prisma.quote.update.mockResolvedValue({});

      const item = QuotePartSupply.reconstitute({
        quoteId: quote.id,
        partSupplyId: randomUUID(),
        quantity: 4,
        unitPrice: 40,
        totalPrice: 160,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await repository.updatePartSupplyItemQuantity(item);

      expect(prisma.quotePartSupply.update).toHaveBeenCalled();
    });
  });

  describe('findAllPaginated', () => {
    it('should return paginated quotes with workOrder included', async () => {
      prisma.quote.findMany.mockResolvedValue([
        {
          id: randomUUID(),
          status: QuoteStatus.PENDING,
          servicesAmount: new Prisma.Decimal(0),
          partsAmount: new Prisma.Decimal(0),
          totalAmount: new Prisma.Decimal(0),
          workOrder: null,
        },
      ]);
      prisma.quote.count.mockResolvedValue(1);

      const result = await repository.findAllPaginated({ page: 1, limit: 10 }, {});

      expect(result.total).toBe(1);
      expect(result.items).toHaveLength(1);
      expect(prisma.quote.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: expect.objectContaining({ workOrder: expect.any(Object) }),
        }),
      );
    });

    it('should apply filters correctly', async () => {
      prisma.quote.findMany.mockResolvedValue([]);
      prisma.quote.count.mockResolvedValue(0);

      const workOrderId = randomUUID();
      await repository.findAllPaginated(
        { page: 1, limit: 10 },
        { workOrderId, status: QuoteStatus.SENT },
      );

      expect(prisma.quote.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            workOrderId,
            status: QuoteStatus.SENT,
          },
        }),
      );
    });
  });
});
