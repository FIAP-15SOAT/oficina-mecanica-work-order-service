import { ICheckServiceQuoteUsageUseCase } from '@application/ports/input/quote/check-service-quote-usage.use-case.interface';
import { ICheckPartSupplyQuoteUsageUseCase } from '@application/ports/input/quote/check-part-supply-quote-usage.use-case.interface';

import { QuotePresenter } from './quote.presenter';
import { InternalQuoteUsageDataResponse } from './responses/internal-quote.response';

export class InternalQuoteController {
  constructor(
    private readonly checkServiceQuoteUsageUseCase: ICheckServiceQuoteUsageUseCase,
    private readonly checkPartSupplyQuoteUsageUseCase: ICheckPartSupplyQuoteUsageUseCase,
  ) {}

  async findServiceQuoteUsage(serviceId: string): Promise<InternalQuoteUsageDataResponse> {
    return QuotePresenter.toInternalUsageDataResponse(
      await this.checkServiceQuoteUsageUseCase.execute(serviceId),
    );
  }

  async findPartSupplyQuoteUsage(partSupplyId: string): Promise<InternalQuoteUsageDataResponse> {
    return QuotePresenter.toInternalUsageDataResponse(
      await this.checkPartSupplyQuoteUsageUseCase.execute(partSupplyId),
    );
  }
}
