import { randomUUID } from 'node:crypto';
import { DecideMyQuoteUseCase } from '@application/use-cases/me/decide-my-quote.use-case';
import { CustomerAccessPolicy } from '@application/policies/customer-access.policy';
import { ResourceNotFoundException } from '@application/exceptions/resource-not-found.exception';
import { ResourceConflictException } from '@application/exceptions/resource-conflict.exception';
import { IBillingQuotesGateway } from '@application/ports/output/gateways/billing/billing-quotes-gateway.interface';
import { IWorkOrderRepository } from '@domain/interfaces/repositories/work-order.repository.interface';
import { ISagaInstanceRepository } from '@domain/interfaces/repositories/saga-instance.repository.interface';
import { QuoteDecisionAction } from '@domain/enums/quote-decision-action.enum';
import { WorkOrderStatus } from '@domain/enums/work-order-status.enum';
import { BusinessRuleViolationException } from '@domain/exceptions/business-rule-violation.exception';
import {
  createMockWorkOrder,
  createMockWorkOrderRepository,
} from '../../../../helpers/work-order-mock.factory';
import { createMockSagaInstanceRepository } from '../../../../helpers/saga-instance-mock.factory';
import {
  createMockBillingQuotesGateway,
  readInternalQuoteFixture,
} from '../../../../helpers/billing-quotes-gateway-mock.factory';

describe('DecideMyQuoteUseCase', () => {
  let useCase: DecideMyQuoteUseCase;
  let billingQuotesGateway: jest.Mocked<IBillingQuotesGateway>;
  let workOrderRepository: jest.Mocked<IWorkOrderRepository>;
  let sagaInstanceRepository: jest.Mocked<ISagaInstanceRepository>;
  let customerAccessPolicy: jest.Mocked<CustomerAccessPolicy>;

  beforeEach(() => {
    billingQuotesGateway = createMockBillingQuotesGateway();

    workOrderRepository = createMockWorkOrderRepository();

    sagaInstanceRepository = createMockSagaInstanceRepository();

    customerAccessPolicy = {
      getAuthorizedCustomerIds: jest.fn(),
      assertCustomerAuthorized: jest.fn(),
    } as unknown as jest.Mocked<CustomerAccessPolicy>;

    useCase = new DecideMyQuoteUseCase(
      billingQuotesGateway,
      workOrderRepository,
      sagaInstanceRepository,
      customerAccessPolicy,
    );
  });

  it('should forward the decision with the customer as author after checking link, status and saga', async () => {
    const userId = randomUUID();
    const quote = readInternalQuoteFixture().data;
    const workOrder = createMockWorkOrder({
      id: quote.workOrderId,
      status: WorkOrderStatus.AWAITING_APPROVAL,
    });

    const decided = { ...quote, decidedBy: userId };

    billingQuotesGateway.getQuote.mockResolvedValue(quote);
    workOrderRepository.findById.mockResolvedValue(workOrder);
    billingQuotesGateway.decide.mockResolvedValue(decided);

    const result = await useCase.execute(userId, quote.id, { action: QuoteDecisionAction.APPROVE });

    expect(result).toBe(decided);

    expect(customerAccessPolicy.assertCustomerAuthorized).toHaveBeenCalledWith(
      userId,
      workOrder.customerId,
    );

    expect(sagaInstanceRepository.hasActiveByWorkOrderId).toHaveBeenCalledWith(workOrder.id);

    expect(billingQuotesGateway.decide).toHaveBeenCalledWith(quote.id, {
      action: QuoteDecisionAction.APPROVE,
      reason: null,
      decidedBy: userId,
    });

    expect(sagaInstanceRepository.hasActiveByWorkOrderId.mock.invocationCallOrder[0]).toBeLessThan(
      billingQuotesGateway.decide.mock.invocationCallOrder[0],
    );
  });

  it('should forward the rejection reason', async () => {
    const userId = randomUUID();
    const quote = readInternalQuoteFixture().data;

    billingQuotesGateway.getQuote.mockResolvedValue(quote);

    workOrderRepository.findById.mockResolvedValue(
      createMockWorkOrder({ id: quote.workOrderId, status: WorkOrderStatus.AWAITING_APPROVAL }),
    );
    billingQuotesGateway.decide.mockResolvedValue(quote);

    await useCase.execute(userId, quote.id, {
      action: QuoteDecisionAction.REJECT,
      reason: 'Preço muito alto',
    });

    expect(billingQuotesGateway.decide).toHaveBeenCalledWith(quote.id, {
      action: QuoteDecisionAction.REJECT,
      reason: 'Preço muito alto',
      decidedBy: userId,
    });
  });

  it('should answer 409 without forwarding when the work order is not awaiting approval', async () => {
    const quote = readInternalQuoteFixture().data;

    billingQuotesGateway.getQuote.mockResolvedValue(quote);

    workOrderRepository.findById.mockResolvedValue(
      createMockWorkOrder({ id: quote.workOrderId, status: WorkOrderStatus.APPROVED }),
    );

    await expect(
      useCase.execute(randomUUID(), quote.id, { action: QuoteDecisionAction.APPROVE }),
    ).rejects.toThrow(
      new BusinessRuleViolationException(
        'Orçamento só pode ser decidido com a Ordem de Serviço aguardando aprovação. Status atual: "APPROVED"',
      ),
    );

    expect(billingQuotesGateway.decide).not.toHaveBeenCalled();
  });

  it('should answer 409 without forwarding when a quote approval is in progress', async () => {
    const quote = readInternalQuoteFixture().data;

    billingQuotesGateway.getQuote.mockResolvedValue(quote);
    workOrderRepository.findById.mockResolvedValue(
      createMockWorkOrder({ id: quote.workOrderId, status: WorkOrderStatus.AWAITING_APPROVAL }),
    );
    sagaInstanceRepository.hasActiveByWorkOrderId.mockResolvedValue(true);

    await expect(
      useCase.execute(randomUUID(), quote.id, { action: QuoteDecisionAction.APPROVE }),
    ).rejects.toThrow(
      new ResourceConflictException(
        'Ordem de serviço com aprovação de orçamento em andamento: aguarde a conclusão e tente novamente',
      ),
    );

    expect(billingQuotesGateway.decide).not.toHaveBeenCalled();
  });

  it('should answer 404 without forwarding for a quote of an unlinked work order', async () => {
    const quote = readInternalQuoteFixture().data;

    billingQuotesGateway.getQuote.mockResolvedValue(quote);

    workOrderRepository.findById.mockResolvedValue(
      createMockWorkOrder({ id: quote.workOrderId, status: WorkOrderStatus.AWAITING_APPROVAL }),
    );

    customerAccessPolicy.assertCustomerAuthorized.mockRejectedValue(
      new ResourceNotFoundException('Recurso'),
    );

    await expect(
      useCase.execute(randomUUID(), quote.id, { action: QuoteDecisionAction.APPROVE }),
    ).rejects.toThrow(ResourceNotFoundException);

    expect(sagaInstanceRepository.hasActiveByWorkOrderId).not.toHaveBeenCalled();
    expect(billingQuotesGateway.decide).not.toHaveBeenCalled();
  });

  it('should answer 404 without forwarding when the work order of the quote does not exist', async () => {
    const quote = readInternalQuoteFixture().data;

    billingQuotesGateway.getQuote.mockResolvedValue(quote);
    workOrderRepository.findById.mockResolvedValue(null);

    await expect(
      useCase.execute(randomUUID(), quote.id, { action: QuoteDecisionAction.APPROVE }),
    ).rejects.toThrow(new ResourceNotFoundException('Orçamento', quote.id));

    expect(customerAccessPolicy.assertCustomerAuthorized).not.toHaveBeenCalled();
    expect(billingQuotesGateway.decide).not.toHaveBeenCalled();
  });
});
