import { randomUUID } from 'node:crypto';
import { FindMyWorkOrdersQuotesUseCase } from '@application/use-cases/me/find-my-work-orders-quotes.use-case';
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
  readInternalWorkOrderQuotesFixture,
} from '../../../../helpers/billing-quotes-gateway-mock.factory';

describe('FindMyWorkOrdersQuotesUseCase', () => {
  let useCase: FindMyWorkOrdersQuotesUseCase;
  let workOrderRepository: jest.Mocked<IWorkOrderRepository>;
  let billingQuotesGateway: jest.Mocked<IBillingQuotesGateway>;
  let customerAccessPolicy: jest.Mocked<CustomerAccessPolicy>;

  beforeEach(() => {
    workOrderRepository = createMockWorkOrderRepository();

    billingQuotesGateway = createMockBillingQuotesGateway();

    customerAccessPolicy = {
      getAuthorizedCustomerIds: jest.fn(),
      assertCustomerAuthorized: jest.fn(),
    } as unknown as jest.Mocked<CustomerAccessPolicy>;

    useCase = new FindMyWorkOrdersQuotesUseCase(
      workOrderRepository,
      billingQuotesGateway,
      customerAccessPolicy,
    );
  });

  it('should list the work order quotes in the Billing for a linked customer', async () => {
    const userId = randomUUID();
    const workOrder = createMockWorkOrder();
    const quotes = readInternalWorkOrderQuotesFixture().data;

    workOrderRepository.findById.mockResolvedValue(workOrder);
    billingQuotesGateway.listWorkOrderQuotes.mockResolvedValue(quotes);

    const result = await useCase.execute(userId, workOrder.id);

    expect(result).toBe(quotes);

    expect(customerAccessPolicy.assertCustomerAuthorized).toHaveBeenCalledWith(
      userId,
      workOrder.customerId,
    );

    expect(billingQuotesGateway.listWorkOrderQuotes).toHaveBeenCalledWith(workOrder.id);
  });

  it('should check the link before listing the work order quotes in the Billing', async () => {
    const workOrder = createMockWorkOrder();

    workOrderRepository.findById.mockResolvedValue(workOrder);

    customerAccessPolicy.assertCustomerAuthorized.mockRejectedValue(
      new ResourceNotFoundException('Recurso'),
    );

    await expect(useCase.execute(randomUUID(), workOrder.id)).rejects.toThrow(
      ResourceNotFoundException,
    );

    expect(billingQuotesGateway.listWorkOrderQuotes).not.toHaveBeenCalled();
  });

  it('should answer 404 without calling the Billing for an unknown work order', async () => {
    workOrderRepository.findById.mockResolvedValue(null);

    await expect(useCase.execute(randomUUID(), randomUUID())).rejects.toThrow(
      ResourceNotFoundException,
    );

    expect(customerAccessPolicy.assertCustomerAuthorized).not.toHaveBeenCalled();
    expect(billingQuotesGateway.listWorkOrderQuotes).not.toHaveBeenCalled();
  });
});
