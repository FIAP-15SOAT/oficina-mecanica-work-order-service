import { IQuoteRepository } from '@domain/interfaces/repositories/quote.repository.interface';

import { ICheckPartSupplyQuoteUsageUseCase } from '@application/ports/input/quote/check-part-supply-quote-usage.use-case.interface';

export class CheckPartSupplyQuoteUsageUseCase implements ICheckPartSupplyQuoteUsageUseCase {
  constructor(private readonly quoteRepository: IQuoteRepository) {}

  execute(partSupplyId: string): Promise<boolean> {
    return this.quoteRepository.isPartSupplyInUse(partSupplyId);
  }
}
