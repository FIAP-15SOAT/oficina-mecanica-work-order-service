import { Quote } from '@domain/entities/quote.entity';
import { SagaInstance } from '@domain/entities/saga-instance.entity';
import { StatusHistory } from '@domain/entities/status-history.entity';
import { WorkOrder } from '@domain/entities/work-order.entity';
import { QuoteStatus } from '@domain/enums/quote-status.enum';
import { SagaStatus } from '@domain/enums/saga-status.enum';
import { SagaType } from '@domain/enums/saga-type.enum';
import { WorkOrderStatus } from '@domain/enums/work-order-status.enum';

import { IRepositories, IUnitOfWork } from '@domain/interfaces/repositories/unit-of-work.interface';
import { IStatusHistoryRepository } from '@domain/interfaces/repositories/status-history.repository.interface';
import { ISagaInstanceRepository } from '@domain/interfaces/repositories/saga-instance.repository.interface';
import { IOutboxRepository } from '@domain/interfaces/repositories/outbox.repository.interface';
import { ILogger } from '@application/ports/output/services/logger.service.interface';
import { IMetrics } from '@application/ports/output/services/metrics.service.interface';
import { BUSINESS_EVENTS } from '@application/logging/business-event.catalog';
import { recordWorkOrderTransition } from '@application/metrics/work-order-metrics';
import { IApproveQuoteUseCase } from '@application/ports/input/quote/approve-quote.use-case.interface';
import { ResourceNotFoundException } from '@application/exceptions/resource-not-found.exception';
import { ICache } from '@application/ports/output/services/cache.service.interface';
import { workOrderCacheKey } from '@application/keys/work-order-cache-key';

interface QuoteApproval {
  quote: Quote;
  workOrder: WorkOrder;
  previousQuoteStatus: QuoteStatus;
  previousStatus: WorkOrderStatus;
  transition?: StatusHistory;
}

export class ApproveQuoteUseCase implements IApproveQuoteUseCase {
  constructor(
    private readonly unitOfWork: IUnitOfWork,
    private readonly logger: ILogger,
    private readonly metrics: IMetrics,
    private readonly statusHistoryRepository: IStatusHistoryRepository,
    private readonly cache: ICache,
  ) {}

  async execute(quoteId: string, userId?: string | null): Promise<Quote> {
    const { quote, workOrder, previousQuoteStatus, previousStatus, transition } =
      await this.unitOfWork.executeTransaction((repos) =>
        this.approve(repos, quoteId, userId ?? null),
      );

    await this.cache.delete([workOrderCacheKey(workOrder.id)]);

    this.logger.event(BUSINESS_EVENTS.QUOTE_APPROVED, {
      quoteId: quote.id,
      previousQuoteStatus,
      workOrderId: workOrder.id,
      workOrderNumber: workOrder.number.toString(),
      previousWorkOrderStatus: previousStatus,
      customerId: workOrder.customerId,
    });

    await recordWorkOrderTransition(this.metrics, this.statusHistoryRepository, transition);

    return quote;
  }

  private async approve(
    repos: IRepositories,
    quoteId: string,
    decidedBy: string | null,
  ): Promise<QuoteApproval> {
    const quote = await repos.quote.findByIdWithDetails(quoteId);

    if (!quote) {
      throw new ResourceNotFoundException('Orçamento', quoteId);
    }

    const workOrder = (await repos.workOrder.findByIdWithDetails(quote.workOrderId))!;

    const previousQuoteStatus = quote.status;
    const previousStatus = workOrder.status;

    workOrder.ensureCanApproveQuote();
    quote.approve(decidedBy);

    const replacedQuotes = this.rejectOpenQuotes(
      quote,
      await repos.quote.findByWorkOrderId(workOrder.id),
    );

    const awaitsStockReservation = quote.partsSupplies.length > 0;
    const approvedItems = awaitsStockReservation ? null : this.approveWorkOrder(workOrder, quote);

    // Updating the work order with its version serializes concurrent approvals and orders its outbox rows.
    await repos.workOrder.update(workOrder);
    await repos.quote.update(quote);
    await Promise.all(replacedQuotes.map((replacedQuote) => repos.quote.update(replacedQuote)));
    await this.saveSaga(repos.sagaInstance, quote, awaitsStockReservation);

    if (!approvedItems) {
      await this.requestStockReservation(repos.outbox, quote);

      return { quote, workOrder, previousQuoteStatus, previousStatus };
    }

    await repos.workOrder.addServiceItems(approvedItems.services);

    const transition = await this.recordApproval(
      repos.statusHistory,
      workOrder.id,
      previousStatus,
      decidedBy,
    );

    return { quote, workOrder, previousQuoteStatus, previousStatus, transition };
  }

  private approveWorkOrder(workOrder: WorkOrder, quote: Quote) {
    workOrder.changeStatus(WorkOrderStatus.APPROVED);

    return workOrder.applyQuoteItems(quote);
  }

  private async saveSaga(
    sagaInstanceRepository: ISagaInstanceRepository,
    quote: Quote,
    awaitsStockReservation: boolean,
  ): Promise<void> {
    const compensatedSaga = await sagaInstanceRepository.findByTypeAndCorrelationId(
      SagaType.QUOTE_APPROVAL,
      quote.id,
    );

    if (compensatedSaga) {
      compensatedSaga.reopenStockReservation();
      await sagaInstanceRepository.update(compensatedSaga);

      return;
    }

    await sagaInstanceRepository.create(
      SagaInstance.create({
        type: SagaType.QUOTE_APPROVAL,
        correlationId: quote.id,
        workOrderId: quote.workOrderId,
        status: awaitsStockReservation ? SagaStatus.RESERVING_STOCK : SagaStatus.COMPLETED,
      }),
    );
  }

  private async requestStockReservation(outbox: IOutboxRepository, quote: Quote): Promise<void> {
    await outbox.add({
      type: 'inventory.stock.reserve',
      workOrderId: quote.workOrderId,
      payload: {
        quoteId: quote.id,
        items: quote.partsSupplies.map((item) => ({
          partSupplyId: item.partSupplyId,
          quantity: item.quantity,
        })),
      },
    });
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

  private rejectOpenQuotes(approvedQuote: Quote, workOrderQuotes: Quote[]): Quote[] {
    const openQuotes = workOrderQuotes.filter(
      (other) =>
        other.id !== approvedQuote.id &&
        (other.status === QuoteStatus.PENDING || other.status === QuoteStatus.SENT),
    );

    openQuotes.forEach((openQuote) => openQuote.rejectByApprovalOf(approvedQuote.id));

    return openQuotes;
  }
}
