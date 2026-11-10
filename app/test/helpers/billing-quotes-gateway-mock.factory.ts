import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { IBillingQuotesGateway } from '@application/ports/output/gateways/billing/billing-quotes-gateway.interface';
import {
  BillingQuoteGatewayResponse,
  BillingQuoteWithItemsGatewayResponse,
} from '@application/ports/output/gateways/billing/billing-quotes-gateway.response';

export interface InternalQuoteFixture {
  data: BillingQuoteWithItemsGatewayResponse;
}

export interface InternalQuoteSummaryFixture {
  data: BillingQuoteGatewayResponse;
}

export interface InternalWorkOrderQuotesFixture {
  data: BillingQuoteGatewayResponse[];
}

function readFixture<T>(file: string): T {
  return JSON.parse(readFileSync(join(__dirname, '../contracts/billing', file), 'utf8')) as T;
}

export function readInternalQuoteFixture(): InternalQuoteFixture {
  return readFixture('internal-quote.json');
}

export function readInternalQuoteSummaryFixture(): InternalQuoteSummaryFixture {
  return readFixture('internal-quote-summary.json');
}

export function readInternalWorkOrderQuotesFixture(): InternalWorkOrderQuotesFixture {
  return readFixture('internal-work-order-quotes.json');
}

export function createMockBillingQuotesGateway(): jest.Mocked<IBillingQuotesGateway> {
  return {
    createInitialQuote: jest.fn(),
    deleteQuote: jest.fn(),
    getQuote: jest.fn(),
    listWorkOrderQuotes: jest.fn(),
    decide: jest.fn(),
  };
}
