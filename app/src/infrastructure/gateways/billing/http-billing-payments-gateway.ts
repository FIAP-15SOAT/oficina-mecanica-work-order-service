import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { IBillingPaymentsGateway } from '@application/ports/output/gateways/billing/billing-payments-gateway.interface';
import {
  BillingPaymentGatewayResponse,
  BillingWorkOrderBalanceGatewayResponse,
} from '@application/ports/output/gateways/billing/billing-payments-gateway.response';
import { InternalHttpClient } from '@infrastructure/clients/internal-http-client';

@Injectable()
export class HttpBillingPaymentsGateway implements IBillingPaymentsGateway {
  private readonly baseUrl: string;

  constructor(
    private readonly internalHttpClient: InternalHttpClient,
    configService: ConfigService,
  ) {
    this.baseUrl = configService.getOrThrow<string>('BILLING_SERVICE_URL');
  }

  async getWorkOrderBalance(workOrderId: string): Promise<BillingWorkOrderBalanceGatewayResponse> {
    const { data } = await this.internalHttpClient.request<{
      data: BillingWorkOrderBalanceGatewayResponse;
    }>({
      method: 'GET',
      url: `${this.baseUrl}/internal/work-orders/${workOrderId}/balance`,
    });

    return data;
  }

  async listWorkOrderPayments(workOrderId: string): Promise<BillingPaymentGatewayResponse[]> {
    const { data } = await this.internalHttpClient.request<{
      data: BillingPaymentGatewayResponse[];
    }>({
      method: 'GET',
      url: `${this.baseUrl}/internal/work-orders/${workOrderId}/payments`,
    });

    return data;
  }
}
