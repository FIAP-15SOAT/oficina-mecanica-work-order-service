import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { IBillingPaymentsGateway } from '@application/ports/output/gateways/billing/billing-payments-gateway.interface';
import {
  BillingPaymentGatewayResponse,
  BillingWorkOrderBalanceGatewayResponse,
} from '@application/ports/output/gateways/billing/billing-payments-gateway.response';

export interface InternalWorkOrderBalanceFixture {
  data: BillingWorkOrderBalanceGatewayResponse;
}

export interface InternalWorkOrderPaymentsFixture {
  data: BillingPaymentGatewayResponse[];
}

function readFixture<T>(file: string): T {
  return JSON.parse(readFileSync(join(__dirname, '../contracts/billing', file), 'utf8')) as T;
}

export function readInternalWorkOrderBalanceFixture(): InternalWorkOrderBalanceFixture {
  return readFixture('internal-work-order-balance.json');
}

export function readInternalWorkOrderPaymentsFixture(): InternalWorkOrderPaymentsFixture {
  return readFixture('internal-work-order-payments.json');
}

export function createMockBillingPaymentsGateway(): jest.Mocked<IBillingPaymentsGateway> {
  return {
    getWorkOrderBalance: jest.fn(),
    listWorkOrderPayments: jest.fn(),
  };
}
