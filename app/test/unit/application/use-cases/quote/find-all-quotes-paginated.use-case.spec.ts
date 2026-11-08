import { FindAllQuotesPaginatedUseCase } from '@application/use-cases/quote/find-all-quotes-paginated.use-case';
import { IQuoteRepository } from '@domain/interfaces/repositories/quote.repository.interface';
import { Quote } from '@domain/entities/quote.entity';
import { QuoteStatus } from '@domain/enums/quote-status.enum';
import { createMockQuoteRepository } from '../../../../helpers/quote-mock.factory';

describe('FindAllQuotesPaginatedUseCase', () => {
  let useCase: FindAllQuotesPaginatedUseCase;
  let quoteRepository: jest.Mocked<IQuoteRepository>;

  beforeEach(() => {
    quoteRepository = createMockQuoteRepository();
    useCase = new FindAllQuotesPaginatedUseCase(quoteRepository);
  });

  it('should return paginated quotes', async () => {
    const quotes = [
      Quote.reconstitute({
        id: 'q1',
        workOrderId: 'wo-1',
        status: QuoteStatus.PENDING,
        servicesAmount: 0,
        partsAmount: 0,
        totalAmount: 0,
        version: 0,
        notes: null,
        sentAt: null,
        approvedAt: null,
        rejectedAt: null,
        replacedByQuoteId: null,
        decidedBy: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      Quote.reconstitute({
        id: 'q2',
        workOrderId: 'wo-2',
        status: QuoteStatus.SENT,
        servicesAmount: 0,
        partsAmount: 0,
        totalAmount: 0,
        version: 0,
        notes: null,
        sentAt: null,
        approvedAt: null,
        rejectedAt: null,
        replacedByQuoteId: null,
        decidedBy: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    ];

    const paginatedResult = {
      items: quotes,
      pagination: {
        totalRecords: 2,
        totalPages: 1,
        page: 1,
        limit: 10,
      },
    };

    quoteRepository.findAllPaginated.mockResolvedValue({
      items: quotes,
      total: 2,
    });

    const input = { page: 1, limit: 10 };
    const result = await useCase.execute(input);

    expect(result).toEqual(paginatedResult);
    expect(quoteRepository.findAllPaginated).toHaveBeenCalledWith({ page: 1, limit: 10 }, {});
  });

  it('should call repository with filters', async () => {
    const input = { workOrderId: 'wo-1', status: QuoteStatus.APPROVED, page: 2, limit: 5 };

    quoteRepository.findAllPaginated.mockResolvedValue({ items: [], total: 0 });

    await useCase.execute(input);

    expect(quoteRepository.findAllPaginated).toHaveBeenCalledWith(
      { page: 2, limit: 5 },
      { workOrderId: 'wo-1', status: QuoteStatus.APPROVED },
    );
  });
});
