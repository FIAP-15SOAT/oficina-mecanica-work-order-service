import { IWorkOrderRepository } from '@domain/interfaces/repositories/work-order.repository.interface';
import { CustomerAccessPolicy } from '@application/policies/customer-access.policy';
import { ResourceNotFoundException } from '@application/exceptions/resource-not-found.exception';
import { IFindMyWorkOrdersQuotesUseCase } from '@application/ports/input/me/find-my-work-orders-quotes.use-case.interface';
import { IBillingQuotesGateway } from '@application/ports/output/gateways/billing/billing-quotes-gateway.interface';
import { BillingQuoteGatewayResponse } from '@application/ports/output/gateways/billing/billing-quotes-gateway.response';

export class FindMyWorkOrdersQuotesUseCase implements IFindMyWorkOrdersQuotesUseCase {
  constructor(
    private readonly workOrderRepository: IWorkOrderRepository,
    private readonly billingQuotesGateway: IBillingQuotesGateway,
    private readonly customerAccessPolicy: CustomerAccessPolicy,
  ) {}

  async execute(userId: string, workOrderId: string): Promise<BillingQuoteGatewayResponse[]> {
    const workOrder = await this.workOrderRepository.findById(workOrderId);

    if (!workOrder) {
      throw new ResourceNotFoundException('Ordem de Serviço', workOrderId);
    }

    await this.customerAccessPolicy.assertCustomerAuthorized(userId, workOrder.customerId);

    return this.billingQuotesGateway.listWorkOrderQuotes(workOrderId);
  }
}
