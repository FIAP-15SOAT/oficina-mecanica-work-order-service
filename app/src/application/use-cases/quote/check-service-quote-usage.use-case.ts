import { IQuoteRepository } from '@domain/interfaces/repositories/quote.repository.interface';

import { ICheckServiceQuoteUsageUseCase } from '@application/ports/input/quote/check-service-quote-usage.use-case.interface';

export class CheckServiceQuoteUsageUseCase implements ICheckServiceQuoteUsageUseCase {
  constructor(private readonly quoteRepository: IQuoteRepository) {}

  execute(serviceId: string): Promise<boolean> {
    return this.quoteRepository.isServiceInUse(serviceId);
  }
}
