import { SagaInstance } from '@domain/entities/saga-instance.entity';
import { StatusHistory } from '@domain/entities/status-history.entity';
import { WorkOrder } from '@domain/entities/work-order.entity';
import { SagaFailureReason } from '@domain/enums/saga-failure-reason.enum';
import { SagaStatus } from '@domain/enums/saga-status.enum';
import { SagaType } from '@domain/enums/saga-type.enum';
import { WorkOrderStatus } from '@domain/enums/work-order-status.enum';
import { ISagaInstanceRepository } from '@domain/interfaces/repositories/saga-instance.repository.interface';
import { IStatusHistoryRepository } from '@domain/interfaces/repositories/status-history.repository.interface';
import { IRepositories, IUnitOfWork } from '@domain/interfaces/repositories/unit-of-work.interface';

import { workOrderCacheKey } from '@application/keys/work-order-cache-key';
import { BUSINESS_EVENTS } from '@application/logging/business-event.catalog';
import { recordWorkOrderTransition } from '@application/metrics/work-order-metrics';
import { StartQuoteApprovalInputDto } from '@application/ports/input/quote-approval/dto/start-quote-approval.dto';
import { IStartQuoteApprovalUseCase } from '@application/ports/input/quote-approval/start-quote-approval.use-case.interface';
import { ICache } from '@application/ports/output/services/cache.service.interface';
import { ILogger } from '@application/ports/output/services/logger.service.interface';
import { IMetrics } from '@application/ports/output/services/metrics.service.interface';

type QuoteApprovalStart =
  | { outcome: 'skipped'; sagaStatus: SagaStatus }
  | { outcome: 'stock_reservation_requested'; saga: SagaInstance; workOrder: WorkOrder }
  | { outcome: 'reversal_requested'; saga: SagaInstance; workOrder: WorkOrder }
  | {
      outcome: 'completed';
      saga: SagaInstance;
      workOrder: WorkOrder;
      workOrderStatusTransition: StatusHistory;
    };

export class StartQuoteApprovalUseCase implements IStartQuoteApprovalUseCase {
  constructor(
    private readonly unitOfWork: IUnitOfWork,
    private readonly logger: ILogger,
    private readonly metrics: IMetrics,
    private readonly statusHistoryRepository: IStatusHistoryRepository,
    private readonly cache: ICache,
  ) {}

  async execute(input: StartQuoteApprovalInputDto): Promise<void> {
    const start = await this.unitOfWork.executeTransaction((repos) => this.start(repos, input));

    if (start.outcome === 'skipped') {
      this.logger.event(BUSINESS_EVENTS.QUOTE_APPROVAL_STEP_SKIPPED, {
        quoteId: input.quoteId,
        sagaStatus: start.sagaStatus,
      });

      return;
    }

    const sagaFields = {
      sagaId: start.saga.id,
      quoteId: input.quoteId,
      workOrderId: input.workOrderId,
      workOrderNumber: start.workOrder.number.toString(),
    };

    if (start.outcome === 'stock_reservation_requested') {
      this.logger.event(BUSINESS_EVENTS.QUOTE_APPROVAL_STARTED, sagaFields);

      return;
    }

    if (start.outcome === 'reversal_requested') {
      this.logger.event(BUSINESS_EVENTS.QUOTE_APPROVAL_COMPENSATION_REQUESTED, {
        ...sagaFields,
        sagaFailureReason: SagaFailureReason.WORK_ORDER_NOT_AWAITING,
      });

      return;
    }

    await this.cache.delete([workOrderCacheKey(input.workOrderId)]);

    this.logger.event(BUSINESS_EVENTS.QUOTE_APPROVAL_COMPLETED, sagaFields);

    await recordWorkOrderTransition(
      this.metrics,
      this.statusHistoryRepository,
      start.workOrderStatusTransition,
    );
  }

  private async start(
    repos: IRepositories,
    input: StartQuoteApprovalInputDto,
  ): Promise<QuoteApprovalStart> {
    const saga = await repos.sagaInstance.findByTypeAndCorrelationId(
      SagaType.QUOTE_APPROVAL,
      input.quoteId,
    );

    // A redelivered approval finds its saga; only one compensated for missing stock takes a new approval.
    if (saga && !saga.isReopenable) {
      return { outcome: 'skipped', sagaStatus: saga.status };
    }

    const workOrder = (await repos.workOrder.findByIdWithDetails(input.workOrderId))!;

    // The work order may have been cancelled between the decision in the Billing and this event.
    if (workOrder.status !== WorkOrderStatus.AWAITING_APPROVAL) {
      return this.requestApprovalReversal(repos, workOrder, saga, input);
    }

    if (input.partsSupplies.length > 0) {
      return this.requestStockReservation(repos, workOrder, saga, input);
    }

    return this.approveWorkOrder(repos, workOrder, input);
  }

  private async requestApprovalReversal(
    repos: IRepositories,
    workOrder: WorkOrder,
    compensatedSaga: SagaInstance | null,
    input: StartQuoteApprovalInputDto,
  ): Promise<QuoteApprovalStart> {
    // Updating the work order with its version serializes concurrent approvals and orders its outbox rows.
    await repos.workOrder.update(workOrder);

    const saga = await this.saveSaga(
      repos.sagaInstance,
      compensatedSaga,
      input,
      SagaStatus.COMPENSATING,
      SagaFailureReason.WORK_ORDER_NOT_AWAITING,
    );

    await repos.outbox.add({
      type: 'billing.quote.revert_approval',
      workOrderId: workOrder.id,
      payload: { quoteId: input.quoteId, revertTo: 'REJECTED' },
    });

    return { outcome: 'reversal_requested', saga, workOrder };
  }

  private async requestStockReservation(
    repos: IRepositories,
    workOrder: WorkOrder,
    compensatedSaga: SagaInstance | null,
    input: StartQuoteApprovalInputDto,
  ): Promise<QuoteApprovalStart> {
    await repos.workOrder.update(workOrder);

    const saga = await this.saveSaga(
      repos.sagaInstance,
      compensatedSaga,
      input,
      SagaStatus.RESERVING_STOCK,
      null,
    );

    await repos.outbox.add({
      type: 'inventory.stock.reserve',
      workOrderId: workOrder.id,
      payload: {
        quoteId: input.quoteId,
        items: input.partsSupplies.map(({ partSupplyId, quantity }) => ({
          partSupplyId,
          quantity,
        })),
      },
    });

    return { outcome: 'stock_reservation_requested', saga, workOrder };
  }

  private async approveWorkOrder(
    repos: IRepositories,
    workOrder: WorkOrder,
    input: StartQuoteApprovalInputDto,
  ): Promise<QuoteApprovalStart> {
    const previousStatus = workOrder.status;

    workOrder.changeStatus(WorkOrderStatus.APPROVED);

    const approvedItems = workOrder.applyApprovedItems(input);

    await repos.workOrder.update(workOrder);

    const saga = await repos.sagaInstance.create(
      SagaInstance.create({
        type: SagaType.QUOTE_APPROVAL,
        correlationId: input.quoteId,
        workOrderId: workOrder.id,
        status: SagaStatus.COMPLETED,
      }),
    );

    await repos.workOrder.addServiceItems(approvedItems.services);

    const workOrderStatusTransition = await repos.statusHistory.create(
      StatusHistory.create({
        workOrderId: workOrder.id,
        changedById: input.decidedBy,
        previousStatus,
        newStatus: WorkOrderStatus.APPROVED,
      }),
    );

    return { outcome: 'completed', saga, workOrder, workOrderStatusTransition };
  }

  private saveSaga(
    sagaInstanceRepository: ISagaInstanceRepository,
    compensatedSaga: SagaInstance | null,
    { quoteId, workOrderId }: StartQuoteApprovalInputDto,
    status: SagaStatus.RESERVING_STOCK | SagaStatus.COMPENSATING,
    failureReason: SagaFailureReason | null,
  ): Promise<SagaInstance> {
    if (compensatedSaga) {
      compensatedSaga.reopen(status, failureReason);

      return sagaInstanceRepository.update(compensatedSaga);
    }

    return sagaInstanceRepository.create(
      SagaInstance.create({
        type: SagaType.QUOTE_APPROVAL,
        correlationId: quoteId,
        workOrderId,
        status,
        failureReason,
      }),
    );
  }
}
