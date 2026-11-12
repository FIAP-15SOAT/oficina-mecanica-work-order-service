import { IWorkOrderRepository } from '@domain/interfaces/repositories/work-order.repository.interface';
import { CustomerAccessPolicy } from '@application/policies/customer-access.policy';
import { ResourceNotFoundException } from '@application/exceptions/resource-not-found.exception';
import { IFindMyQuoteByIdUseCase } from '@application/ports/input/me/find-my-quote-by-id.use-case.interface';
import { IBillingQuotesGateway } from '@application/ports/output/gateways/billing/billing-quotes-gateway.interface';
import { BillingQuoteWithItemsGatewayResponse } from '@application/ports/output/gateways/billing/billing-quotes-gateway.response';

export class FindMyQuoteByIdUseCase implements IFindMyQuoteByIdUseCase {
  constructor(
    private readonly billingQuotesGateway: IBillingQuotesGateway,
    private readonly workOrderRepository: IWorkOrderRepository,
    private readonly customerAccessPolicy: CustomerAccessPolicy,
  ) {}

  /** Reads the quote first: only the Billing knows which work order it belongs to. */
  async execute(userId: string, quoteId: string): Promise<BillingQuoteWithItemsGatewayResponse> {
    const quote = await this.billingQuotesGateway.getQuote(quoteId);
    const workOrder = await this.workOrderRepository.findById(quote.workOrderId);

    if (!workOrder) {
      throw new ResourceNotFoundException('Orçamento', quoteId);
    }

    await this.customerAccessPolicy.assertCustomerAuthorized(userId, workOrder.customerId);

    return quote;
  }
}
