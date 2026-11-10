import { ConfigService } from '@nestjs/config';

import { ServiceRequestRejectedException } from '@application/exceptions/service-request-rejected.exception';
import { BillingQuoteStatus } from '@application/ports/output/gateways/billing/billing-quotes-gateway.response';
import { QuoteDecisionAction } from '@domain/enums/quote-decision-action.enum';
import { InternalHttpClient } from '@infrastructure/clients/internal-http-client';
import { ServiceIntegrationException } from '@infrastructure/exceptions/service-integration.exception';
import { HttpBillingQuotesGateway } from '@infrastructure/gateways/billing/http-billing-quotes-gateway';

import {
  readInternalQuoteFixture,
  readInternalQuoteSummaryFixture,
  readInternalWorkOrderQuotesFixture,
} from '../../../../helpers/billing-quotes-gateway-mock.factory';

describe('HttpBillingQuotesGateway', () => {
  const baseUrl = 'http://billing-service.billing.svc.cluster.local:3000';
  const quoteFixture = readInternalQuoteFixture();
  const summaryFixture = readInternalQuoteSummaryFixture();
  const workOrderQuotesFixture = readInternalWorkOrderQuotesFixture();

  let internalHttpClient: jest.Mocked<Pick<InternalHttpClient, 'request'>>;
  let gateway: HttpBillingQuotesGateway;

  beforeEach(() => {
    internalHttpClient = { request: jest.fn() };

    gateway = new HttpBillingQuotesGateway(
      internalHttpClient as unknown as InternalHttpClient,
      new ConfigService({ BILLING_SERVICE_URL: baseUrl }),
    );
  });

  describe('createInitialQuote', () => {
    const input = {
      workOrderId: summaryFixture.data.workOrderId,
      services: [{ serviceId: quoteFixture.data.services[0].id, quantity: 1 }],
      partsSupplies: [{ partSupplyId: quoteFixture.data.partsSupplies[0].id, quantity: 2 }],
    };

    it('should create the initial quote with the chain timeout and return the summary fixture', async () => {
      internalHttpClient.request.mockResolvedValue(summaryFixture);

      const quote = await gateway.createInitialQuote(input);

      expect(quote).toEqual(summaryFixture.data);
      expect(quote.status).toBe(BillingQuoteStatus.PENDING);
      expect(internalHttpClient.request).toHaveBeenCalledWith({
        method: 'POST',
        url: `${baseUrl}/internal/quotes`,
        body: input,
        timeoutMs: 5_000,
      });
    });

    it('should let an owner rejection of the initial quote through', async () => {
      const rejection = new ServiceRequestRejectedException(
        409,
        'Orçamento com peças exige ao menos um serviço',
      );

      internalHttpClient.request.mockRejectedValue(rejection);

      await expect(gateway.createInitialQuote(input)).rejects.toBe(rejection);
    });
  });

  describe('deleteQuote', () => {
    it('should delete a quote', async () => {
      internalHttpClient.request.mockResolvedValue(undefined);

      await gateway.deleteQuote(summaryFixture.data.id);

      expect(internalHttpClient.request).toHaveBeenCalledWith({
        method: 'DELETE',
        url: `${baseUrl}/internal/quotes/${summaryFixture.data.id}`,
      });
    });

    it('should treat a quote the owner no longer has as deleted', async () => {
      internalHttpClient.request.mockRejectedValue(
        new ServiceRequestRejectedException(404, 'Orçamento não encontrado(a)'),
      );

      await expect(gateway.deleteQuote(summaryFixture.data.id)).resolves.toBeUndefined();
    });

    it.each([
      ['an owner rejection', new ServiceRequestRejectedException(409, 'Orçamento já enviado')],
      ['unavailability', new ServiceIntegrationException('Serviço de destino indisponível')],
    ])('should let any other delete failure through: %s', async (_, failure) => {
      internalHttpClient.request.mockRejectedValue(failure);

      await expect(gateway.deleteQuote(summaryFixture.data.id)).rejects.toBe(failure);
    });
  });

  it('should read a quote with its items with the chain timeout', async () => {
    internalHttpClient.request.mockResolvedValue(quoteFixture);

    const quote = await gateway.getQuote(quoteFixture.data.id);

    expect(quote).toEqual(quoteFixture.data);
    expect(quote.status).toBe(BillingQuoteStatus.APPROVED);
    expect(internalHttpClient.request).toHaveBeenCalledWith({
      method: 'GET',
      url: `${baseUrl}/internal/quotes/${quoteFixture.data.id}`,
      timeoutMs: 5_000,
    });
  });

  it('should list the work order quotes with the default timeout', async () => {
    const { workOrderId } = workOrderQuotesFixture.data[0];

    internalHttpClient.request.mockResolvedValue(workOrderQuotesFixture);

    const quotes = await gateway.listWorkOrderQuotes(workOrderId);

    expect(quotes).toEqual(workOrderQuotesFixture.data);
    expect(internalHttpClient.request).toHaveBeenCalledWith({
      method: 'GET',
      url: `${baseUrl}/internal/work-orders/${workOrderId}/quotes`,
    });
  });

  it('should forward the decision with its author', async () => {
    const decision = {
      action: QuoteDecisionAction.APPROVE,
      reason: null,
      decidedBy: quoteFixture.data.decidedBy as string,
    };

    internalHttpClient.request.mockResolvedValue(quoteFixture);

    const quote = await gateway.decide(quoteFixture.data.id, decision);

    expect(quote).toEqual(quoteFixture.data);
    expect(internalHttpClient.request).toHaveBeenCalledWith({
      method: 'POST',
      url: `${baseUrl}/internal/quotes/${quoteFixture.data.id}/decisions`,
      body: decision,
      timeoutMs: 5_000,
    });
  });

  it('should refuse to start without BILLING_SERVICE_URL', () => {
    expect(
      () =>
        new HttpBillingQuotesGateway(
          internalHttpClient as unknown as InternalHttpClient,
          new ConfigService({}),
        ),
    ).toThrow();
  });
});
