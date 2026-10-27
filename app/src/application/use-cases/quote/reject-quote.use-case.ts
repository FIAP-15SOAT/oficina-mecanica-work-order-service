import { Quote } from '@domain/entities/quote.entity';
import { StatusHistory } from '@domain/entities/status-history.entity';
import { WorkOrderStatus } from '@domain/enums/work-order-status.enum';
import { QuoteStatus } from '@domain/enums/quote-status.enum';

import { IUnitOfWork } from '@domain/interfaces/repositories/unit-of-work.interface';
import { IStatusHistoryRepository } from '@domain/interfaces/repositories/status-history.repository.interface';
import { ILogger } from '@application/ports/output/logger.service.interface';
import { IMetrics } from '@application/ports/output/metrics.service.interface';
import { BUSINESS_EVENTS } from '@application/logging/business-event.catalog';
import { recordWorkOrderTransition } from '@application/metrics/work-order-metrics';
import { IRejectQuoteUseCase } from '@application/ports/input/quote/reject-quote.use-case.interface';
import { ResourceNotFoundException } from '@application/exceptions/resource-not-found.exception';
import { ICache } from '@application/ports/output/cache.service.interface';
import { workOrderCacheKey } from '@application/keys/work-order-cache-key';

export class RejectQuoteUseCase implements IRejectQuoteUseCase {
  constructor(
    private readonly unitOfWork: IUnitOfWork,
    private readonly logger: ILogger,
    private readonly metrics: IMetrics,
    private readonly statusHistoryRepository: IStatusHistoryRepository,
    private readonly cache: ICache,
  ) {}

  async execute(quoteId: string, notes?: string | null, userId?: string | null): Promise<Quote> {
    const {
      quote,
      workOrderId,
      workOrderNumber,
      previousQuoteStatus,
      previousStatus,
      transition,
      customerId,
    } = await this.unitOfWork.executeTransaction(async (repos) => {
      const quote = await repos.quote.findById(quoteId);

      if (!quote) {
        throw new ResourceNotFoundException('Orçamento', quoteId);
      }

      const previousQuoteStatus = quote.status;

      quote.reject();

      const workOrder = (await repos.workOrder.findById(quote.workOrderId))!;
      const customerId = workOrder.customerId;
      const workOrderQuotes = await repos.quote.findByWorkOrderId(workOrder.id);

      const hasOtherSentQuote = workOrderQuotes.some(
        (sibling) => sibling.id !== quote.id && sibling.status === QuoteStatus.SENT,
      );

      if (hasOtherSentQuote) {
        // The work order does not transition while another quote is still sent:
        // with no new history entry, there is no dwell time to close.
        return {
          quote: await repos.quote.update(quote),
          workOrderId: workOrder.id,
          workOrderNumber: workOrder.number.toString(),
          previousQuoteStatus,
          previousStatus: undefined,
          transition: undefined,
          customerId,
        };
      }

      const previousStatus = workOrder.status;

      workOrder.changeStatus(WorkOrderStatus.REJECTED);

      const [updatedQuote, , transition] = await Promise.all([
        repos.quote.update(quote),
        repos.workOrder.update(workOrder),
        repos.statusHistory.create(
          StatusHistory.create({
            workOrderId: workOrder.id,
            changedById: userId ?? null,
            previousStatus,
            newStatus: WorkOrderStatus.REJECTED,
            notes: notes ?? `Orçamento ${quoteId} rejeitado`,
          }),
        ),
      ]);

      return {
        quote: updatedQuote,
        workOrderId: workOrder.id,
        workOrderNumber: workOrder.number.toString(),
        previousQuoteStatus,
        previousStatus,
        transition,
        customerId,
      };
    });

    await this.cache.delete([workOrderCacheKey(workOrderId)]);

    this.logger.event(BUSINESS_EVENTS.QUOTE_REJECTED, {
      quoteId: quote.id,
      previousQuoteStatus,
      workOrderId,
      workOrderNumber,
      previousWorkOrderStatus: previousStatus,
      workOrderStatusChanged: previousStatus !== undefined,
      customerId,
    });

    await recordWorkOrderTransition(this.metrics, this.statusHistoryRepository, transition);

    return quote;
  }
}
