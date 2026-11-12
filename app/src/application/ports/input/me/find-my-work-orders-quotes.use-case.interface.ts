import { BillingQuoteGatewayResponse } from '@application/ports/output/gateways/billing/billing-quotes-gateway.response';

export interface IFindMyWorkOrdersQuotesUseCase {
  execute(userId: string, workOrderId: string): Promise<BillingQuoteGatewayResponse[]>;
}
