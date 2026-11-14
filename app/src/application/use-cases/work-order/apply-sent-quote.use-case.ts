import { StatusHistory } from '@domain/entities/status-history.entity';
import { WorkOrder } from '@domain/entities/work-order.entity';
import { WorkOrderStatus } from '@domain/enums/work-order-status.enum';
import { IStatusHistoryRepository } from '@domain/interfaces/repositories/status-history.repository.interface';
import { IRepositories, IUnitOfWork } from '@domain/interfaces/repositories/unit-of-work.interface';

import { workOrderCacheKey } from '@application/keys/work-order-cache-key';
import { BUSINESS_EVENTS } from '@application/logging/business-event.catalog';
import { recordWorkOrderTransition } from '@application/metrics/work-order-metrics';
import { WorkOrderEmailComposer } from '@application/notifications/work-order-email.composer';
import { IApplySentQuoteUseCase } from '@application/ports/input/work-order/apply-sent-quote.use-case.interface';
import { ApplySentQuoteInputDto } from '@application/ports/input/work-order/dto/apply-sent-quote.dto';
import { ICache } from '@application/ports/output/services/cache.service.interface';
import { ILogger } from '@application/ports/output/services/logger.service.interface';
import { IMetrics } from '@application/ports/output/services/metrics.service.interface';
import {
  CustomerEmailRecipient,
  CustomerEmailRecipientsResolver,
} from '@application/services/customer-email-recipients';

type SentQuoteApplication =
  | { applied: false; currentWorkOrderStatus: WorkOrderStatus }
  | { applied: true; workOrderStatusTransition?: StatusHistory };

export class ApplySentQuoteUseCase implements IApplySentQuoteUseCase {
  constructor(
    private readonly unitOfWork: IUnitOfWork,
    private readonly recipientsResolver: CustomerEmailRecipientsResolver,
    private readonly logger: ILogger,
    private readonly metrics: IMetrics,
    private readonly statusHistoryRepository: IStatusHistoryRepository,
    private readonly cache: ICache,
  ) {}

  async execute(input: ApplySentQuoteInputDto): Promise<void> {
    const recipients = await this.recipientsResolver.resolveForWorkOrder(input.workOrderId);

    const application = await this.unitOfWork.executeTransaction((repos) =>
      this.apply(repos, input, recipients),
    );

    if (!application.applied) {
      this.logger.event(BUSINESS_EVENTS.QUOTE_EVENT_SKIPPED, {
        quoteId: input.quoteId,
        workOrderId: input.workOrderId,
        currentWorkOrderStatus: application.currentWorkOrderStatus,
      });

      return;
    }

    const { workOrderStatusTransition } = application;

    if (workOrderStatusTransition) {
      await this.cache.delete([workOrderCacheKey(input.workOrderId)]);
    }

    await recordWorkOrderTransition(
      this.metrics,
      this.statusHistoryRepository,
      workOrderStatusTransition,
    );
  }

  private async apply(
    repos: IRepositories,
    input: ApplySentQuoteInputDto,
    recipients: CustomerEmailRecipient[],
  ): Promise<SentQuoteApplication> {
    const workOrder = (await repos.workOrder.findById(input.workOrderId))!;

    if (workOrder.status === WorkOrderStatus.AWAITING_APPROVAL) {
      // Updating the work order with its version orders its outbox rows against concurrent writers.
      await repos.workOrder.update(workOrder);

      await this.addQuoteEmails(repos, workOrder, input, recipients);

      return { applied: true };
    }

    // The work order may have changed (e.g. been cancelled) between the send and this event.
    if (!workOrder.canChangeStatusTo(WorkOrderStatus.AWAITING_APPROVAL)) {
      return { applied: false, currentWorkOrderStatus: workOrder.status };
    }

    const workOrderStatusTransition = await this.moveWorkOrderToAwaitingApproval(
      repos,
      workOrder,
      input.sentBy,
    );

    await this.addQuoteEmails(repos, workOrder, input, recipients);

    return { applied: true, workOrderStatusTransition };
  }

  private async moveWorkOrderToAwaitingApproval(
    repos: IRepositories,
    workOrder: WorkOrder,
    sentBy: string,
  ): Promise<StatusHistory> {
    const previousStatus = workOrder.status;

    workOrder.changeStatus(WorkOrderStatus.AWAITING_APPROVAL);

    await repos.workOrder.update(workOrder);

    return repos.statusHistory.create(
      StatusHistory.create({
        workOrderId: workOrder.id,
        changedById: sentBy,
        previousStatus,
        newStatus: WorkOrderStatus.AWAITING_APPROVAL,
      }),
    );
  }

  private async addQuoteEmails(
    repos: IRepositories,
    workOrder: WorkOrder,
    { total, items }: ApplySentQuoteInputDto,
    recipients: CustomerEmailRecipient[],
  ): Promise<void> {
    for (const recipient of recipients) {
      await repos.outbox.add(
        WorkOrderEmailComposer.quoteSent({
          recipient,
          workOrderId: workOrder.id,
          workOrderNumber: workOrder.number.toString(),
          total,
          items,
        }),
      );
    }
  }
}
