import { randomUUID } from 'node:crypto';
import { Quote } from '@domain/entities/quote.entity';
import { QuoteService } from '@domain/entities/quote-service.entity';
import { QuotePartSupply } from '@domain/entities/quote-part-supply.entity';
import { QuoteStatus } from '@domain/enums/quote-status.enum';
import { IQuoteRepository } from '@domain/interfaces/repositories/quote.repository.interface';
import { IUnitOfWork, IRepositories } from '@domain/interfaces/repositories/unit-of-work.interface';

export function createMockQuote(overrides: Partial<Quote> = {}): Quote {
  const now = new Date();

  return Quote.reconstitute({
    id: randomUUID(),
    workOrderId: randomUUID(),
    status: QuoteStatus.PENDING,
    notes: null,
    servicesAmount: 0,
    partsAmount: 0,
    totalAmount: 0,
    version: 1,
    sentAt: null,
    approvedAt: null,
    rejectedAt: null,
    replacedByQuoteId: null,
    decidedBy: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  });
}

export function createMockQuoteService(overrides: Partial<QuoteService> = {}): QuoteService {
  return QuoteService.reconstitute({
    quoteId: randomUUID(),
    serviceId: randomUUID(),
    quantity: 1,
    unitPrice: 100,
    totalPrice: 100,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });
}

export function createMockQuotePartSupply(
  overrides: Partial<QuotePartSupply> = {},
): QuotePartSupply {
  return QuotePartSupply.reconstitute({
    quoteId: randomUUID(),
    partSupplyId: randomUUID(),
    quantity: 2,
    unitPrice: 50,
    totalPrice: 100,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });
}

export function createMockQuoteRepository(): jest.Mocked<IQuoteRepository> {
  return {
    create: jest.fn(),
    findById: jest.fn(),
    findByIdWithDetails: jest.fn(),
    findByWorkOrderId: jest.fn(),
    findAllPaginated: jest.fn(),
    update: jest.fn(),
    addServiceItem: jest.fn(),
    removeServiceItem: jest.fn(),
    updateServiceItemQuantity: jest.fn(),
    addPartSupplyItem: jest.fn(),
    removePartSupplyItem: jest.fn(),
    updatePartSupplyItemQuantity: jest.fn(),
    isServiceInUse: jest.fn(),
    isPartSupplyInUse: jest.fn(),
  };
}

export function createMockUnitOfWork(
  quoteRepo: jest.Mocked<IQuoteRepository>,
): jest.Mocked<IUnitOfWork> {
  return {
    executeTransaction: jest
      .fn()
      .mockImplementation((work: (repos: IRepositories) => unknown) =>
        work({ quote: quoteRepo } as unknown as IRepositories),
      ),
  };
}
