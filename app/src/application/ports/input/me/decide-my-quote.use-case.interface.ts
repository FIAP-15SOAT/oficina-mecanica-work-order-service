import { BillingQuoteWithItemsGatewayResponse } from '@application/ports/output/gateways/billing/billing-quotes-gateway.response';
import { QuoteDecisionDto } from './dto/quote-decision.dto';

export interface IDecideMyQuoteUseCase {
  execute(
    userId: string,
    quoteId: string,
    input: QuoteDecisionDto,
  ): Promise<BillingQuoteWithItemsGatewayResponse>;
}
