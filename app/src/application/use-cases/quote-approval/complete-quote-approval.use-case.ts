import { Quote } from '@domain/entities/quote.entity';
import { SagaInstance } from '@domain/entities/saga-instance.entity';
import { StatusHistory } from '@domain/entities/status-history.entity';
import { WorkOrder } from '@domain/entities/work-order.entity';
import { SagaStatus } from '@domain/enums/saga-status.enum';
import { SagaType } from '@domain/enums/saga-type.enum';
import { WorkOrderStatus } from '@domain/enums/work-order-status.enum';

import { IRepositories, IUnitOfWork } from '@domain/interfaces/repositories/unit-of-work.interface';
import { IStatusHistoryRepository } from '@domain/interfaces/repositories/status-history.repository.interface';
import { ILogger } from '@application/ports/output/services/logger.service.interface';
import { IMetrics } from '@application/ports/output/services/metrics.service.interface';
import { ICache } from '@application/ports/output/services/cache.service.interface';
import { BUSINESS_EVENTS } from '@application/logging/business-event.catalog';
import { recordWorkOrderTransition } from '@application/metrics/work-order-metrics';
import { workOrderCacheKey } from '@application/keys/work-order-cache-key';
import { ICompleteQuoteApprovalUseCase } from '@application/ports/input/quote-approval/complete-quote-approval.use-case.interface';

type ApprovalCompletion =
  | { completed: false; sagaStatus?: SagaStatus }
  | { completed: true; saga: SagaInstance; workOrder: WorkOrder; transition: StatusHistory };

export class CompleteQuoteApprovalUseCase implements ICompleteQuoteApprovalUseCase {
  constructor(
    private readonly unitOfWork: IUnitOfWork,
    private readonly logger: ILogger,
    private readonly metrics: IMetrics,
    private readonly statusHistoryRepository: IStatusHistoryRepository,
    private readonly cache: ICache,
  ) {}

  async execute(quoteId: string): Promise<void> {
    const completion = await this.unitOfWork.executeTransaction((repos) =>
      this.complete(repos, quoteId),
    );

    if (!completion.completed) {
      this.logger.event(BUSINESS_EVENTS.QUOTE_APPROVAL_STEP_SKIPPED, {
        quoteId,
        sagaStatus: completion.sagaStatus,
      });

      return;
    }

    const { saga, workOrder, transition } = completion;

    await this.cache.delete([workOrderCacheKey(workOrder.id)]);

    this.logger.event(BUSINESS_EVENTS.QUOTE_APPROVAL_COMPLETED, {
      sagaId: saga.id,
      quoteId,
      workOrderId: workOrder.id,
      workOrderNumber: workOrder.number.toString(),
    });

    await recordWorkOrderTransition(this.metrics, this.statusHistoryRepository, transition);
  }

  private async complete(repos: IRepositories, quoteId: string): Promise<ApprovalCompletion> {
    const saga = await repos.sagaInstance.findByTypeAndCorrelationId(
      SagaType.QUOTE_APPROVAL,
      quoteId,
    );

    // A duplicated or late reply finds the saga already settled; at-least-once delivery makes it expected.
    if (saga?.status !== SagaStatus.RESERVING_STOCK) {
      return { completed: false, sagaStatus: saga?.status };
    }

    const quote = (await repos.quote.findByIdWithDetails(quoteId))!;
    const workOrder = (await repos.workOrder.findByIdWithDetails(saga.workOrderId))!;

    const previousStatus = workOrder.status;

    const approvedItems = this.approveWorkOrder(workOrder, quote);

    saga.complete();

    await repos.workOrder.update(workOrder);
    await repos.workOrder.addServiceItems(approvedItems.services);
    await repos.workOrder.addPartSupplyItems(approvedItems.partSupplies);
    await repos.sagaInstance.update(saga);

    const transition = await this.recordApproval(
      repos.statusHistory,
      workOrder.id,
      previousStatus,
      quote.decidedBy,
    );

    return { completed: true, saga, workOrder, transition };
  }

  private approveWorkOrder(workOrder: WorkOrder, quote: Quote) {
    workOrder.changeStatus(WorkOrderStatus.APPROVED);

    return workOrder.applyQuoteItems(quote);
  }

  private recordApproval(
    statusHistoryRepository: IStatusHistoryRepository,
    workOrderId: string,
    previousStatus: WorkOrderStatus,
    decidedBy: string | null,
  ): Promise<StatusHistory> {
    return statusHistoryRepository.create(
      StatusHistory.create({
        workOrderId,
        changedById: decidedBy,
        previousStatus,
        newStatus: WorkOrderStatus.APPROVED,
        notes: null,
      }),
    );
  }
}
