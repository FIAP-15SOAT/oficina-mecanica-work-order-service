import { BillingQuoteWithItemsGatewayResponse } from '@application/ports/output/gateways/billing/billing-quotes-gateway.response';

export interface IFindMyQuoteByIdUseCase {
  execute(userId: string, quoteId: string): Promise<BillingQuoteWithItemsGatewayResponse>;
}
