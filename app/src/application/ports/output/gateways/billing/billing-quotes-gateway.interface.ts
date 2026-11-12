import { QuoteDecisionAction } from '@domain/enums/quote-decision-action.enum';

import {
  BillingQuoteGatewayResponse,
  BillingQuoteWithItemsGatewayResponse,
} from './billing-quotes-gateway.response';

export interface CreateInitialQuoteGatewayInput {
  workOrderId: string;
  services: { serviceId: string; quantity: number }[];
  partsSupplies: { partSupplyId: string; quantity: number }[];
}

export interface DecideQuoteGatewayInput {
  action: QuoteDecisionAction;
  reason: string | null;
  decidedBy: string;
}

export interface IBillingQuotesGateway {
  createInitialQuote(input: CreateInitialQuoteGatewayInput): Promise<BillingQuoteGatewayResponse>;
  /** Resolves when the quote is gone, including when the Billing no longer has it. */
  deleteQuote(quoteId: string): Promise<void>;
  getQuote(quoteId: string): Promise<BillingQuoteWithItemsGatewayResponse>;
  listWorkOrderQuotes(workOrderId: string): Promise<BillingQuoteGatewayResponse[]>;
  decide(
    quoteId: string,
    input: DecideQuoteGatewayInput,
  ): Promise<BillingQuoteWithItemsGatewayResponse>;
}
