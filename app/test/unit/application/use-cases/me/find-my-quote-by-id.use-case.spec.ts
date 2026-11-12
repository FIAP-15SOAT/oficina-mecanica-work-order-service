import { randomUUID } from 'node:crypto';
import { FindMyQuoteByIdUseCase } from '@application/use-cases/me/find-my-quote-by-id.use-case';
import { CustomerAccessPolicy } from '@application/policies/customer-access.policy';
import { ResourceNotFoundException } from '@application/exceptions/resource-not-found.exception';
import { IBillingQuotesGateway } from '@application/ports/output/gateways/billing/billing-quotes-gateway.interface';
import { IWorkOrderRepository } from '@domain/interfaces/repositories/work-order.repository.interface';
import {
  createMockWorkOrder,
  createMockWorkOrderRepository,
} from '../../../../helpers/work-order-mock.factory';
import {
  createMockBillingQuotesGateway,
  readInternalQuoteFixture,
} from '../../../../helpers/billing-quotes-gateway-mock.factory';

describe('FindMyQuoteByIdUseCase', () => {
  let useCase: FindMyQuoteByIdUseCase;
  let billingQuotesGateway: jest.Mocked<IBillingQuotesGateway>;
  let workOrderRepository: jest.Mocked<IWorkOrderRepository>;
  let customerAccessPolicy: jest.Mocked<CustomerAccessPolicy>;

  beforeEach(() => {
    billingQuotesGateway = createMockBillingQuotesGateway();

    workOrderRepository = createMockWorkOrderRepository();

    customerAccessPolicy = {
      getAuthorizedCustomerIds: jest.fn(),
      assertCustomerAuthorized: jest.fn(),
    } as unknown as jest.Mocked<CustomerAccessPolicy>;

    useCase = new FindMyQuoteByIdUseCase(
      billingQuotesGateway,
      workOrderRepository,
      customerAccessPolicy,
    );
  });

  it('should read the quote in the Billing before checking the link of its work order', async () => {
    const userId = randomUUID();
    const quote = readInternalQuoteFixture().data;
    const workOrder = createMockWorkOrder({ id: quote.workOrderId });

    billingQuotesGateway.getQuote.mockResolvedValue(quote);
    workOrderRepository.findById.mockResolvedValue(workOrder);

    const result = await useCase.execute(userId, quote.id);

    expect(result).toBe(quote);
    expect(billingQuotesGateway.getQuote).toHaveBeenCalledWith(quote.id);
    expect(workOrderRepository.findById).toHaveBeenCalledWith(quote.workOrderId);

    expect(customerAccessPolicy.assertCustomerAuthorized).toHaveBeenCalledWith(
      userId,
      workOrder.customerId,
    );

    expect(billingQuotesGateway.getQuote.mock.invocationCallOrder[0]).toBeLessThan(
      customerAccessPolicy.assertCustomerAuthorized.mock.invocationCallOrder[0],
    );
  });

  it('should answer 404 for a quote of an unlinked work order', async () => {
    const quote = readInternalQuoteFixture().data;

    billingQuotesGateway.getQuote.mockResolvedValue(quote);
    workOrderRepository.findById.mockResolvedValue(createMockWorkOrder({ id: quote.workOrderId }));
    customerAccessPolicy.assertCustomerAuthorized.mockRejectedValue(
      new ResourceNotFoundException('Recurso'),
    );

    await expect(useCase.execute(randomUUID(), quote.id)).rejects.toThrow(
      ResourceNotFoundException,
    );
  });

  it('should answer 404 when the work order of the quote does not exist', async () => {
    const quote = readInternalQuoteFixture().data;

    billingQuotesGateway.getQuote.mockResolvedValue(quote);
    workOrderRepository.findById.mockResolvedValue(null);

    await expect(useCase.execute(randomUUID(), quote.id)).rejects.toThrow(
      new ResourceNotFoundException('Orçamento', quote.id),
    );

    expect(customerAccessPolicy.assertCustomerAuthorized).not.toHaveBeenCalled();
  });
});
