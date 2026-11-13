import { randomUUID } from 'node:crypto';
import { FindMyWorkOrderPaymentsUseCase } from '@application/use-cases/me/find-my-work-order-payments.use-case';
import { CustomerAccessPolicy } from '@application/policies/customer-access.policy';
import { ResourceNotFoundException } from '@application/exceptions/resource-not-found.exception';
import { IBillingPaymentsGateway } from '@application/ports/output/gateways/billing/billing-payments-gateway.interface';
import { IWorkOrderRepository } from '@domain/interfaces/repositories/work-order.repository.interface';
import {
  createMockWorkOrder,
  createMockWorkOrderRepository,
} from '../../../../helpers/work-order-mock.factory';
import {
  createMockBillingPaymentsGateway,
  readInternalWorkOrderPaymentsFixture,
} from '../../../../helpers/billing-payments-gateway-mock.factory';

describe('FindMyWorkOrderPaymentsUseCase', () => {
  let useCase: FindMyWorkOrderPaymentsUseCase;
  let workOrderRepository: jest.Mocked<IWorkOrderRepository>;
  let billingPaymentsGateway: jest.Mocked<IBillingPaymentsGateway>;
  let customerAccessPolicy: jest.Mocked<CustomerAccessPolicy>;

  beforeEach(() => {
    workOrderRepository = createMockWorkOrderRepository();

    billingPaymentsGateway = createMockBillingPaymentsGateway();

    customerAccessPolicy = {
      getAuthorizedCustomerIds: jest.fn(),
      assertCustomerAuthorized: jest.fn(),
    } as unknown as jest.Mocked<CustomerAccessPolicy>;

    useCase = new FindMyWorkOrderPaymentsUseCase(
      workOrderRepository,
      billingPaymentsGateway,
      customerAccessPolicy,
    );
  });

  it('should list the payments of a linked work order', async () => {
    const userId = randomUUID();
    const workOrder = createMockWorkOrder();
    const payments = readInternalWorkOrderPaymentsFixture().data;

    workOrderRepository.findById.mockResolvedValue(workOrder);
    billingPaymentsGateway.listWorkOrderPayments.mockResolvedValue(payments);

    const result = await useCase.execute(userId, workOrder.id);

    expect(result).toBe(payments);

    expect(customerAccessPolicy.assertCustomerAuthorized).toHaveBeenCalledWith(
      userId,
      workOrder.customerId,
    );

    expect(billingPaymentsGateway.listWorkOrderPayments).toHaveBeenCalledWith(workOrder.id);
  });

  it('should return 404 when the work order does not exist', async () => {
    workOrderRepository.findById.mockResolvedValue(null);

    await expect(useCase.execute(randomUUID(), randomUUID())).rejects.toThrow(
      ResourceNotFoundException,
    );

    expect(customerAccessPolicy.assertCustomerAuthorized).not.toHaveBeenCalled();
    expect(billingPaymentsGateway.listWorkOrderPayments).not.toHaveBeenCalled();
  });

  it('should return 404 without reading the Billing when the work order is not linked', async () => {
    const workOrder = createMockWorkOrder();

    workOrderRepository.findById.mockResolvedValue(workOrder);

    customerAccessPolicy.assertCustomerAuthorized.mockRejectedValue(
      new ResourceNotFoundException('Recurso'),
    );

    await expect(useCase.execute(randomUUID(), workOrder.id)).rejects.toThrow(
      ResourceNotFoundException,
    );

    expect(billingPaymentsGateway.listWorkOrderPayments).not.toHaveBeenCalled();
  });
});
