import { SagaInstance } from '@domain/entities/saga-instance.entity';
import { StatusHistory } from '@domain/entities/status-history.entity';
import { WorkOrder } from '@domain/entities/work-order.entity';
import { SagaStatus } from '@domain/enums/saga-status.enum';
import { SagaType } from '@domain/enums/saga-type.enum';
import { WorkOrderStatus } from '@domain/enums/work-order-status.enum';

import { IRepositories, IUnitOfWork } from '@domain/interfaces/repositories/unit-of-work.interface';
import { ISagaInstanceRepository } from '@domain/interfaces/repositories/saga-instance.repository.interface';
import { IStatusHistoryRepository } from '@domain/interfaces/repositories/status-history.repository.interface';
import { IBillingQuotesGateway } from '@application/ports/output/gateways/billing/billing-quotes-gateway.interface';
import { BillingQuoteWithItemsGatewayResponse } from '@application/ports/output/gateways/billing/billing-quotes-gateway.response';
import { ILogger } from '@application/ports/output/services/logger.service.interface';
import { IMetrics } from '@application/ports/output/services/metrics.service.interface';
import { ICache } from '@application/ports/output/services/cache.service.interface';
import { BUSINESS_EVENTS } from '@application/logging/business-event.catalog';
import { recordWorkOrderTransition } from '@application/metrics/work-order-metrics';
import { workOrderCacheKey } from '@application/keys/work-order-cache-key';
import { ICompleteQuoteApprovalUseCase } from '@application/ports/input/quote-approval/complete-quote-approval.use-case.interface';

interface ApprovalCompletion {
  workOrder: WorkOrder;
  workOrderStatusTransition: StatusHistory;
}

export class CompleteQuoteApprovalUseCase implements ICompleteQuoteApprovalUseCase {
  constructor(
    private readonly sagaInstanceRepository: ISagaInstanceRepository,
    private readonly billingQuotesGateway: IBillingQuotesGateway,
    private readonly unitOfWork: IUnitOfWork,
    private readonly logger: ILogger,
    private readonly metrics: IMetrics,
    private readonly statusHistoryRepository: IStatusHistoryRepository,
    private readonly cache: ICache,
  ) {}

  async execute(quoteId: string): Promise<void> {
    const saga = await this.sagaInstanceRepository.findByTypeAndCorrelationId(
      SagaType.QUOTE_APPROVAL,
      quoteId,
    );

    // A duplicated or late reply finds the saga already settled; at-least-once delivery makes it expected.
    if (saga?.status !== SagaStatus.RESERVING_STOCK) {
      this.logger.event(BUSINESS_EVENTS.QUOTE_APPROVAL_STEP_SKIPPED, {
        quoteId,
        sagaStatus: saga?.status,
      });

      return;
    }

    // The reservation reply carries only the quote id, and the approved items belong to the Billing.
    const quote = await this.billingQuotesGateway.getQuote(quoteId);

    const { workOrder, workOrderStatusTransition } = await this.unitOfWork.executeTransaction(
      (repos) => this.complete(repos, saga, quote),
    );

    await this.cache.delete([workOrderCacheKey(workOrder.id)]);

    this.logger.event(BUSINESS_EVENTS.QUOTE_APPROVAL_COMPLETED, {
      sagaId: saga.id,
      quoteId,
      workOrderId: workOrder.id,
      workOrderNumber: workOrder.number.toString(),
    });

    await recordWorkOrderTransition(
      this.metrics,
      this.statusHistoryRepository,
      workOrderStatusTransition,
    );
  }

  private async complete(
    repos: IRepositories,
    saga: SagaInstance,
    quote: BillingQuoteWithItemsGatewayResponse,
  ): Promise<ApprovalCompletion> {
    const workOrder = (await repos.workOrder.findByIdWithDetails(saga.workOrderId))!;

    const previousStatus = workOrder.status;

    workOrder.changeStatus(WorkOrderStatus.APPROVED);

    const approvedItems = workOrder.applyApprovedItems({
      services: quote.services.map(({ id, quantity, unitPrice }) => ({
        serviceId: id,
        quantity,
        unitPrice,
      })),
      partsSupplies: quote.partsSupplies.map(({ id, quantity, unitPrice }) => ({
        partSupplyId: id,
        quantity,
        unitPrice,
      })),
    });

    saga.complete();

    await repos.workOrder.update(workOrder);
    await repos.workOrder.addServiceItems(approvedItems.services);
    await repos.workOrder.addPartSupplyItems(approvedItems.partSupplies);
    await repos.sagaInstance.update(saga);

    const workOrderStatusTransition = await repos.statusHistory.create(
      StatusHistory.create({
        workOrderId: workOrder.id,
        changedById: quote.decidedBy,
        previousStatus,
        newStatus: WorkOrderStatus.APPROVED,
      }),
    );

    return { workOrder, workOrderStatusTransition };
  }
}
