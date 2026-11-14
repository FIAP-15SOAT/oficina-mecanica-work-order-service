import { SagaInstance } from '@domain/entities/saga-instance.entity';
import { StatusHistory } from '@domain/entities/status-history.entity';
import { WorkOrder } from '@domain/entities/work-order.entity';
import { SagaFailureReason } from '@domain/enums/saga-failure-reason.enum';
import { SagaStatus } from '@domain/enums/saga-status.enum';
import { SagaType } from '@domain/enums/saga-type.enum';
import { ISagaInstanceRepository } from '@domain/interfaces/repositories/saga-instance.repository.interface';
import { IRepositories, IUnitOfWork } from '@domain/interfaces/repositories/unit-of-work.interface';

import { BUSINESS_EVENTS } from '@application/logging/business-event.catalog';
import { recordSagaTransition } from '@application/metrics/saga-metrics';
import { WorkOrderEmailComposer } from '@application/notifications/work-order-email.composer';
import { IConfirmQuoteApprovalReversalUseCase } from '@application/ports/input/quote-approval/confirm-quote-approval-reversal.use-case.interface';
import { ILogger } from '@application/ports/output/services/logger.service.interface';
import { IMetrics } from '@application/ports/output/services/metrics.service.interface';
import {
  CustomerEmailRecipient,
  CustomerEmailRecipientsResolver,
} from '@application/services/customer-email-recipients';

type ApprovalReversalConfirmation =
  | { confirmed: false; sagaStatus?: SagaStatus }
  | { confirmed: true; saga: SagaInstance; workOrder: WorkOrder };

type QuoteApprovalFailureReason =
  | SagaFailureReason.INSUFFICIENT_STOCK
  | SagaFailureReason.WORK_ORDER_NOT_AWAITING;

const REVERSAL_NOTES: Record<QuoteApprovalFailureReason, (quoteId: string) => string> = {
  [SagaFailureReason.INSUFFICIENT_STOCK]: (quoteId) =>
    `Aprovação do orçamento ${quoteId} desfeita por falta de estoque`,
  [SagaFailureReason.WORK_ORDER_NOT_AWAITING]: (quoteId) =>
    `Aprovação do orçamento ${quoteId} desfeita: a Ordem de Serviço não aguardava aprovação`,
};

export class ConfirmQuoteApprovalReversalUseCase implements IConfirmQuoteApprovalReversalUseCase {
  constructor(
    private readonly unitOfWork: IUnitOfWork,
    private readonly sagaInstanceRepository: ISagaInstanceRepository,
    private readonly recipientsResolver: CustomerEmailRecipientsResolver,
    private readonly logger: ILogger,
    private readonly metrics: IMetrics,
  ) {}

  async execute(quoteId: string): Promise<void> {
    const recipients = await this.resolveMissingStockRecipients(quoteId);

    const confirmation = await this.unitOfWork.executeTransaction((repos) =>
      this.confirm(repos, quoteId, recipients),
    );

    if (!confirmation.confirmed) {
      this.logger.event(BUSINESS_EVENTS.SAGA_STEP_SKIPPED, {
        sagaType: SagaType.QUOTE_APPROVAL,
        quoteId,
        sagaStatus: confirmation.sagaStatus,
      });

      return;
    }

    const { saga, workOrder } = confirmation;

    recordSagaTransition(this.logger, this.metrics, saga, {
      started: false,
      workOrderNumber: workOrder.number.toString(),
    });
  }

  // A work order that left AWAITING_APPROVAL had nothing for the customer to approve again,
  // so only a reversal for missing stock reads the recipients in the Identity.
  private async resolveMissingStockRecipients(quoteId: string): Promise<CustomerEmailRecipient[]> {
    const saga = await this.sagaInstanceRepository.findByTypeAndCorrelationId(
      SagaType.QUOTE_APPROVAL,
      quoteId,
    );

    if (
      saga?.status !== SagaStatus.COMPENSATING ||
      saga.failureReason !== SagaFailureReason.INSUFFICIENT_STOCK
    ) {
      return [];
    }

    return this.recipientsResolver.resolveForWorkOrder(saga.workOrderId);
  }

  private async confirm(
    repos: IRepositories,
    quoteId: string,
    recipients: CustomerEmailRecipient[],
  ): Promise<ApprovalReversalConfirmation> {
    const saga = await repos.sagaInstance.findByTypeAndCorrelationId(
      SagaType.QUOTE_APPROVAL,
      quoteId,
    );

    // A duplicated or late reply finds the saga already settled; at-least-once delivery makes it expected.
    if (saga?.status !== SagaStatus.COMPENSATING) {
      return { confirmed: false, sagaStatus: saga?.status };
    }

    const workOrder = (await repos.workOrder.findById(saga.workOrderId))!;

    const failureReason = saga.failureReason as QuoteApprovalFailureReason;

    saga.compensate();

    const updatedSaga = await repos.sagaInstance.update(saga);
    await repos.statusHistory.create(
      StatusHistory.create({
        workOrderId: workOrder.id,
        changedById: null,
        previousStatus: workOrder.status,
        newStatus: workOrder.status,
        notes: REVERSAL_NOTES[failureReason](quoteId),
      }),
    );

    if (failureReason === SagaFailureReason.INSUFFICIENT_STOCK) {
      await this.addMissingStockEmails(repos, workOrder, recipients);
    }

    return { confirmed: true, saga: updatedSaga, workOrder };
  }

  private async addMissingStockEmails(
    repos: IRepositories,
    workOrder: WorkOrder,
    recipients: CustomerEmailRecipient[],
  ): Promise<void> {
    // Updating the work order with its version orders its outbox rows against concurrent writers.
    await repos.workOrder.update(workOrder);

    for (const recipient of recipients) {
      await repos.outbox.add(
        WorkOrderEmailComposer.quoteApprovalReverted({
          recipient,
          workOrderId: workOrder.id,
          workOrderNumber: workOrder.number.toString(),
        }),
      );
    }
  }
}
