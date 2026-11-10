import { IWorkOrderRepository } from '@domain/interfaces/repositories/work-order.repository.interface';
import { ISagaInstanceRepository } from '@domain/interfaces/repositories/saga-instance.repository.interface';
import { CustomerAccessPolicy } from '@application/policies/customer-access.policy';
import { ResourceNotFoundException } from '@application/exceptions/resource-not-found.exception';
import { ResourceConflictException } from '@application/exceptions/resource-conflict.exception';
import { QuoteDecisionDto } from '@application/ports/input/me/dto/quote-decision.dto';
import { IDecideMyQuoteUseCase } from '@application/ports/input/me/decide-my-quote.use-case.interface';
import { IBillingQuotesGateway } from '@application/ports/output/gateways/billing/billing-quotes-gateway.interface';
import { BillingQuoteWithItemsGatewayResponse } from '@application/ports/output/gateways/billing/billing-quotes-gateway.response';

export class DecideMyQuoteUseCase implements IDecideMyQuoteUseCase {
  constructor(
    private readonly billingQuotesGateway: IBillingQuotesGateway,
    private readonly workOrderRepository: IWorkOrderRepository,
    private readonly sagaInstanceRepository: ISagaInstanceRepository,
    private readonly customerAccessPolicy: CustomerAccessPolicy,
  ) {}

  /** Every check runs before the forward, so a refused decision never reaches the Billing. */
  async execute(
    userId: string,
    quoteId: string,
    dto: QuoteDecisionDto,
  ): Promise<BillingQuoteWithItemsGatewayResponse> {
    const quote = await this.billingQuotesGateway.getQuote(quoteId);
    const workOrder = await this.workOrderRepository.findById(quote.workOrderId);

    if (!workOrder) {
      throw new ResourceNotFoundException('Orçamento', quoteId);
    }

    await this.customerAccessPolicy.assertCustomerAuthorized(userId, workOrder.customerId);

    workOrder.ensureAwaitingQuoteDecision();

    if (await this.sagaInstanceRepository.hasActiveByWorkOrderId(workOrder.id)) {
      throw new ResourceConflictException(
        'Ordem de serviço com aprovação de orçamento em andamento: aguarde a conclusão e tente novamente',
      );
    }

    return this.billingQuotesGateway.decide(quoteId, {
      action: dto.action,
      reason: dto.reason ?? null,
      decidedBy: userId,
    });
  }
}
