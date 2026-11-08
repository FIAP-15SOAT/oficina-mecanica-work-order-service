import { CheckPartSupplyQuoteUsageUseCase } from '@application/use-cases/quote/check-part-supply-quote-usage.use-case';

import { IQuoteRepository } from '@domain/interfaces/repositories/quote.repository.interface';

import { createMockQuoteRepository } from '../../../../helpers/quote-mock.factory';

describe('CheckPartSupplyQuoteUsageUseCase', () => {
  let useCase: CheckPartSupplyQuoteUsageUseCase;
  let quoteRepository: jest.Mocked<IQuoteRepository>;

  beforeEach(() => {
    quoteRepository = createMockQuoteRepository();

    useCase = new CheckPartSupplyQuoteUsageUseCase(quoteRepository);
  });

  it.each([true, false])(
    'should answer %s as the repository reads the part supply usage',
    async (inUse) => {
      quoteRepository.isPartSupplyInUse.mockResolvedValue(inUse);

      await expect(useCase.execute('part-supply-id')).resolves.toBe(inUse);

      expect(quoteRepository.isPartSupplyInUse).toHaveBeenCalledWith('part-supply-id');
    },
  );
});
