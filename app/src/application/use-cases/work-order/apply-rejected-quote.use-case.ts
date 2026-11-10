import { StatusHistory } from '@domain/entities/status-history.entity';
import { WorkOrderStatus } from '@domain/enums/work-order-status.enum';
import { IStatusHistoryRepository } from '@domain/interfaces/repositories/status-history.repository.interface';
import { IRepositories, IUnitOfWork } from '@domain/interfaces/repositories/unit-of-work.interface';

import { workOrderCacheKey } from '@application/keys/work-order-cache-key';
import { BUSINESS_EVENTS } from '@application/logging/business-event.catalog';
import { recordWorkOrderTransition } from '@application/metrics/work-order-metrics';
import { IApplyRejectedQuoteUseCase } from '@application/ports/input/work-order/apply-rejected-quote.use-case.interface';
import { ApplyRejectedQuoteInputDto } from '@application/ports/input/work-order/dto/apply-rejected-quote.dto';
import { ICache } from '@application/ports/output/services/cache.service.interface';
import { ILogger } from '@application/ports/output/services/logger.service.interface';
import { IMetrics } from '@application/ports/output/services/metrics.service.interface';

type RejectedQuoteApplication =
  | { applied: false; currentWorkOrderStatus: WorkOrderStatus }
  | { applied: true; workOrderStatusTransition?: StatusHistory };

export class ApplyRejectedQuoteUseCase implements IApplyRejectedQuoteUseCase {
  constructor(
    private readonly unitOfWork: IUnitOfWork,
    private readonly logger: ILogger,
    private readonly metrics: IMetrics,
    private readonly statusHistoryRepository: IStatusHistoryRepository,
    private readonly cache: ICache,
  ) {}

  async execute(input: ApplyRejectedQuoteInputDto): Promise<void> {
    const application = await this.unitOfWork.executeTransaction((repos) =>
      this.apply(repos, input),
    );

    if (!application.applied) {
      this.logger.event(BUSINESS_EVENTS.QUOTE_EVENT_SKIPPED, {
        quoteId: input.quoteId,
        workOrderId: input.workOrderId,
        currentWorkOrderStatus: application.currentWorkOrderStatus,
      });

      return;
    }

    if (!application.workOrderStatusTransition) {
      return;
    }

    await this.cache.delete([workOrderCacheKey(input.workOrderId)]);

    await recordWorkOrderTransition(
      this.metrics,
      this.statusHistoryRepository,
      application.workOrderStatusTransition,
    );
  }

  private async apply(
    repos: IRepositories,
    { workOrderId, reason, remainingSentCount, decidedBy }: ApplyRejectedQuoteInputDto,
  ): Promise<RejectedQuoteApplication> {
    const workOrder = (await repos.workOrder.findById(workOrderId))!;

    if (!workOrder.canChangeStatusTo(WorkOrderStatus.REJECTED)) {
      return { applied: false, currentWorkOrderStatus: workOrder.status };
    }

    // Another sent quote still awaits the customer, so the work order keeps waiting.
    if (remainingSentCount > 0) {
      return { applied: true };
    }

    workOrder.changeStatus(WorkOrderStatus.REJECTED);

    await repos.workOrder.update(workOrder);

    const workOrderStatusTransition = await repos.statusHistory.create(
      StatusHistory.create({
        workOrderId: workOrder.id,
        changedById: decidedBy,
        previousStatus: WorkOrderStatus.AWAITING_APPROVAL,
        newStatus: WorkOrderStatus.REJECTED,
        notes: reason,
      }),
    );

    return { applied: true, workOrderStatusTransition };
  }
}
