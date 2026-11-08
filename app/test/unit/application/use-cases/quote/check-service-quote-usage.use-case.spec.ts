import { CheckServiceQuoteUsageUseCase } from '@application/use-cases/quote/check-service-quote-usage.use-case';

import { IQuoteRepository } from '@domain/interfaces/repositories/quote.repository.interface';

import { createMockQuoteRepository } from '../../../../helpers/quote-mock.factory';

describe('CheckServiceQuoteUsageUseCase', () => {
  let useCase: CheckServiceQuoteUsageUseCase;
  let quoteRepository: jest.Mocked<IQuoteRepository>;

  beforeEach(() => {
    quoteRepository = createMockQuoteRepository();

    useCase = new CheckServiceQuoteUsageUseCase(quoteRepository);
  });

  it.each([true, false])(
    'should answer %s as the repository reads the service usage',
    async (inUse) => {
      quoteRepository.isServiceInUse.mockResolvedValue(inUse);

      await expect(useCase.execute('service-id')).resolves.toBe(inUse);

      expect(quoteRepository.isServiceInUse).toHaveBeenCalledWith('service-id');
    },
  );
});
