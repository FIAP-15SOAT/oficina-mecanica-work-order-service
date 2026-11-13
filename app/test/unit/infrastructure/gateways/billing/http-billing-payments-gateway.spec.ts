import { ConfigService } from '@nestjs/config';

import { BillingPaymentStatus } from '@application/ports/output/gateways/billing/billing-payments-gateway.response';
import { InternalHttpClient } from '@infrastructure/clients/internal-http-client';
import { HttpBillingPaymentsGateway } from '@infrastructure/gateways/billing/http-billing-payments-gateway';

import {
  readInternalWorkOrderBalanceFixture,
  readInternalWorkOrderPaymentsFixture,
} from '../../../../helpers/billing-payments-gateway-mock.factory';

describe('HttpBillingPaymentsGateway', () => {
  const baseUrl = 'http://billing-service.billing.svc.cluster.local:3000';
  const balanceFixture = readInternalWorkOrderBalanceFixture();
  const paymentsFixture = readInternalWorkOrderPaymentsFixture();
  const { workOrderId } = paymentsFixture.data[0];

  let internalHttpClient: jest.Mocked<Pick<InternalHttpClient, 'request'>>;
  let gateway: HttpBillingPaymentsGateway;

  beforeEach(() => {
    internalHttpClient = { request: jest.fn() };

    gateway = new HttpBillingPaymentsGateway(
      internalHttpClient as unknown as InternalHttpClient,
      new ConfigService({ BILLING_SERVICE_URL: baseUrl }),
    );
  });

  it('should read the work order balance', async () => {
    internalHttpClient.request.mockResolvedValue(balanceFixture);

    const balance = await gateway.getWorkOrderBalance(workOrderId);

    expect(balance).toEqual({ approvedTotal: '500.00', paidTotal: '100.00', balance: '400.00' });

    expect(internalHttpClient.request).toHaveBeenCalledWith({
      method: 'GET',
      url: `${baseUrl}/internal/work-orders/${workOrderId}/balance`,
    });
  });

  it('should list the work order payments', async () => {
    internalHttpClient.request.mockResolvedValue(paymentsFixture);

    const payments = await gateway.listWorkOrderPayments(workOrderId);

    expect(payments).toEqual(paymentsFixture.data);
    expect(payments.map((payment) => payment.status)).toEqual([
      BillingPaymentStatus.APPROVED,
      BillingPaymentStatus.PENDING,
    ]);

    expect(internalHttpClient.request).toHaveBeenCalledWith({
      method: 'GET',
      url: `${baseUrl}/internal/work-orders/${workOrderId}/payments`,
    });
  });

  it('should refuse to start without BILLING_SERVICE_URL', () => {
    expect(
      () =>
        new HttpBillingPaymentsGateway(
          internalHttpClient as unknown as InternalHttpClient,
          new ConfigService({}),
        ),
    ).toThrow();
  });
});
