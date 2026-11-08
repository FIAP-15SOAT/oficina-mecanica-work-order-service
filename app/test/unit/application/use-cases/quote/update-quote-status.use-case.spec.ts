import { UpdateQuoteStatusUseCase } from '@application/use-cases/quote/update-quote-status.use-case';
import { IApproveQuoteUseCase } from '@application/ports/input/quote-approval/approve-quote.use-case.interface';
import { IRejectQuoteUseCase } from '@application/ports/input/quote/reject-quote.use-case.interface';
import { BadRequestException } from '@application/exceptions/bad-request.exception';
import { QuoteStatus } from '@domain/enums/quote-status.enum';
import { createMockQuote } from '../../../../helpers/quote-mock.factory';
import { randomUUID } from 'node:crypto';

describe('UpdateQuoteStatusUseCase', () => {
  let useCase: UpdateQuoteStatusUseCase;
  let approveQuoteUseCase: jest.Mocked<IApproveQuoteUseCase>;
  let rejectQuoteUseCase: jest.Mocked<IRejectQuoteUseCase>;

  beforeEach(() => {
    approveQuoteUseCase = {
      execute: jest.fn(),
    };
    rejectQuoteUseCase = {
      execute: jest.fn(),
    };
    useCase = new UpdateQuoteStatusUseCase(approveQuoteUseCase, rejectQuoteUseCase);
  });

  it('should call approveQuoteUseCase when status is APPROVED', async () => {
    const quoteId = randomUUID();
    const userId = randomUUID();
    const quote = createMockQuote({ id: quoteId });
    approveQuoteUseCase.execute.mockResolvedValue(quote);

    const result = await useCase.execute(quoteId, userId, { status: QuoteStatus.APPROVED });

    expect(result).toBe(quote);
    expect(approveQuoteUseCase.execute).toHaveBeenCalledWith(quoteId, userId);
  });

  it('should call rejectQuoteUseCase when status is REJECTED', async () => {
    const quoteId = randomUUID();
    const userId = randomUUID();
    const reason = 'Price too high';
    const quote = createMockQuote({ id: quoteId });
    rejectQuoteUseCase.execute.mockResolvedValue(quote);

    const result = await useCase.execute(quoteId, userId, { status: QuoteStatus.REJECTED, reason });

    expect(result).toBe(quote);
    expect(rejectQuoteUseCase.execute).toHaveBeenCalledWith(quoteId, reason, userId);
  });

  it('should throw BadRequestException when status is REJECTED and reason is missing', async () => {
    const quoteId = randomUUID();
    const userId = randomUUID();

    await expect(
      useCase.execute(quoteId, userId, { status: QuoteStatus.REJECTED }),
    ).rejects.toThrow(BadRequestException);
  });
});
