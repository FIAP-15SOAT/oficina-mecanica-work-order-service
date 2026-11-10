import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ServiceRequestRejectedException } from '@application/exceptions/service-request-rejected.exception';
import {
  CreateInitialQuoteGatewayInput,
  DecideQuoteGatewayInput,
  IBillingQuotesGateway,
} from '@application/ports/output/gateways/billing/billing-quotes-gateway.interface';
import {
  BillingQuoteGatewayResponse,
  BillingQuoteWithItemsGatewayResponse,
} from '@application/ports/output/gateways/billing/billing-quotes-gateway.response';
import { InternalHttpClient } from '@infrastructure/clients/internal-http-client';

// The Billing reads the Inventory catalog before answering these calls.
const BILLING_CHAIN_TIMEOUT_MS = 5_000;
const NOT_FOUND_STATUS = 404;

@Injectable()
export class HttpBillingQuotesGateway implements IBillingQuotesGateway {
  private readonly baseUrl: string;

  constructor(
    private readonly internalHttpClient: InternalHttpClient,
    configService: ConfigService,
  ) {
    this.baseUrl = configService.getOrThrow<string>('BILLING_SERVICE_URL');
  }

  async createInitialQuote(
    input: CreateInitialQuoteGatewayInput,
  ): Promise<BillingQuoteGatewayResponse> {
    const { data } = await this.internalHttpClient.request<{ data: BillingQuoteGatewayResponse }>({
      method: 'POST',
      url: `${this.baseUrl}/internal/quotes`,
      body: input,
      timeoutMs: BILLING_CHAIN_TIMEOUT_MS,
    });

    return data;
  }

  async deleteQuote(quoteId: string): Promise<void> {
    try {
      await this.internalHttpClient.request<void>({
        method: 'DELETE',
        url: `${this.baseUrl}/internal/quotes/${quoteId}`,
      });
    } catch (error) {
      if (
        !(error instanceof ServiceRequestRejectedException) ||
        error.statusCode !== NOT_FOUND_STATUS
      ) {
        throw error;
      }
    }
  }

  async getQuote(quoteId: string): Promise<BillingQuoteWithItemsGatewayResponse> {
    const { data } = await this.internalHttpClient.request<{
      data: BillingQuoteWithItemsGatewayResponse;
    }>({
      method: 'GET',
      url: `${this.baseUrl}/internal/quotes/${quoteId}`,
      timeoutMs: BILLING_CHAIN_TIMEOUT_MS,
    });

    return data;
  }

  async listWorkOrderQuotes(workOrderId: string): Promise<BillingQuoteGatewayResponse[]> {
    const { data } = await this.internalHttpClient.request<{
      data: BillingQuoteGatewayResponse[];
    }>({
      method: 'GET',
      url: `${this.baseUrl}/internal/work-orders/${workOrderId}/quotes`,
    });

    return data;
  }

  async decide(
    quoteId: string,
    input: DecideQuoteGatewayInput,
  ): Promise<BillingQuoteWithItemsGatewayResponse> {
    const { data } = await this.internalHttpClient.request<{
      data: BillingQuoteWithItemsGatewayResponse;
    }>({
      method: 'POST',
      url: `${this.baseUrl}/internal/quotes/${quoteId}/decisions`,
      body: input,
      timeoutMs: BILLING_CHAIN_TIMEOUT_MS,
    });

    return data;
  }
}
