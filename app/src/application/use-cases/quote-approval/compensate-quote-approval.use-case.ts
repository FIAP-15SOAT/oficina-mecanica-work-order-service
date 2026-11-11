import { SagaInstance } from '@domain/entities/saga-instance.entity';
import { WorkOrder } from '@domain/entities/work-order.entity';
import { SagaFailureReason } from '@domain/enums/saga-failure-reason.enum';
import { SagaStatus } from '@domain/enums/saga-status.enum';
import { SagaType } from '@domain/enums/saga-type.enum';
import { IRepositories, IUnitOfWork } from '@domain/interfaces/repositories/unit-of-work.interface';

import { BUSINESS_EVENTS } from '@application/logging/business-event.catalog';
import { ICompensateQuoteApprovalUseCase } from '@application/ports/input/quote-approval/compensate-quote-approval.use-case.interface';
import { CompensateQuoteApprovalInputDto } from '@application/ports/input/quote-approval/dto/compensate-quote-approval.dto';
import { ILogger } from '@application/ports/output/services/logger.service.interface';

type ApprovalCompensation =
  | { requested: false; sagaStatus?: SagaStatus }
  | { requested: true; saga: SagaInstance; workOrder: WorkOrder };

export class CompensateQuoteApprovalUseCase implements ICompensateQuoteApprovalUseCase {
  constructor(
    private readonly unitOfWork: IUnitOfWork,
    private readonly logger: ILogger,
  ) {}

  async execute({ quoteId, missingItemCount }: CompensateQuoteApprovalInputDto): Promise<void> {
    const compensation = await this.unitOfWork.executeTransaction((repos) =>
      this.requestCompensation(repos, quoteId),
    );

    if (!compensation.requested) {
      this.logger.event(BUSINESS_EVENTS.QUOTE_APPROVAL_STEP_SKIPPED, {
        quoteId,
        sagaStatus: compensation.sagaStatus,
      });

      return;
    }

    const { saga, workOrder } = compensation;

    this.logger.event(BUSINESS_EVENTS.QUOTE_APPROVAL_COMPENSATION_REQUESTED, {
      sagaId: saga.id,
      quoteId,
      workOrderId: workOrder.id,
      workOrderNumber: workOrder.number.toString(),
      sagaFailureReason: SagaFailureReason.INSUFFICIENT_STOCK,
      missingItemCount,
    });
  }

  private async requestCompensation(
    repos: IRepositories,
    quoteId: string,
  ): Promise<ApprovalCompensation> {
    const saga = await repos.sagaInstance.findByTypeAndCorrelationId(
      SagaType.QUOTE_APPROVAL,
      quoteId,
    );

    // A duplicated or late reply finds the saga already settled; at-least-once delivery makes it expected.
    if (saga?.status !== SagaStatus.RESERVING_STOCK) {
      return { requested: false, sagaStatus: saga?.status };
    }

    const workOrder = (await repos.workOrder.findById(saga.workOrderId))!;

    saga.requestCompensation(SagaFailureReason.INSUFFICIENT_STOCK);

    // Updating the work order with its version orders its outbox rows against concurrent writers.
    await repos.workOrder.update(workOrder);
    await repos.sagaInstance.update(saga);
    await repos.outbox.add({
      type: 'billing.quote.revert_approval',
      workOrderId: workOrder.id,
      payload: { quoteId, revertTo: 'SENT' },
    });

    return { requested: true, saga, workOrder };
  }
}
