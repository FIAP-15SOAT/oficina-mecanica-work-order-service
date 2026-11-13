import { Customer } from '@domain/entities/customer.entity';
import { SagaInstance } from '@domain/entities/saga-instance.entity';
import { StatusHistory } from '@domain/entities/status-history.entity';
import { WorkOrder } from '@domain/entities/work-order.entity';
import { SagaFailureReason } from '@domain/enums/saga-failure-reason.enum';
import { SagaStatus } from '@domain/enums/saga-status.enum';
import { SagaType } from '@domain/enums/saga-type.enum';
import { IRepositories, IUnitOfWork } from '@domain/interfaces/repositories/unit-of-work.interface';

import { BUSINESS_EVENTS } from '@application/logging/business-event.catalog';
import { IConfirmQuoteApprovalReversalUseCase } from '@application/ports/input/quote-approval/confirm-quote-approval-reversal.use-case.interface';
import {
  IEmailSenderService,
  SendEmailInput,
} from '@application/ports/output/services/email-sender.service.interface';
import { ILogger } from '@application/ports/output/services/logger.service.interface';
import { IMetrics } from '@application/ports/output/services/metrics.service.interface';
import { recordSagaTransition } from '@application/metrics/saga-metrics';

type ApprovalReversalConfirmation =
  | { confirmed: false; sagaStatus?: SagaStatus }
  | {
      confirmed: true;
      saga: SagaInstance;
      failureReason: SagaFailureReason;
      workOrder: WorkOrder;
    };

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
    private readonly logger: ILogger,
    private readonly emailSender: IEmailSenderService,
    private readonly metrics: IMetrics,
  ) {}

  async execute(quoteId: string): Promise<void> {
    const confirmation = await this.unitOfWork.executeTransaction((repos) =>
      this.confirm(repos, quoteId),
    );

    if (!confirmation.confirmed) {
      this.logger.event(BUSINESS_EVENTS.SAGA_STEP_SKIPPED, {
        sagaType: SagaType.QUOTE_APPROVAL,
        quoteId,
        sagaStatus: confirmation.sagaStatus,
      });

      return;
    }

    const { saga, failureReason, workOrder } = confirmation;

    recordSagaTransition(this.logger, this.metrics, saga, {
      started: false,
      workOrderNumber: workOrder.number.toString(),
    });

    // A work order that left AWAITING_APPROVAL had nothing for the customer to approve again.
    if (failureReason === SagaFailureReason.INSUFFICIENT_STOCK) {
      await this.notifyCustomer(workOrder);
    }
  }

  private async confirm(
    repos: IRepositories,
    quoteId: string,
  ): Promise<ApprovalReversalConfirmation> {
    const saga = await repos.sagaInstance.findByTypeAndCorrelationId(
      SagaType.QUOTE_APPROVAL,
      quoteId,
    );

    // A duplicated or late reply finds the saga already settled; at-least-once delivery makes it expected.
    if (saga?.status !== SagaStatus.COMPENSATING) {
      return { confirmed: false, sagaStatus: saga?.status };
    }

    const workOrder = (await repos.workOrder.findByIdWithDetails(saga.workOrderId))!;

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

    return { confirmed: true, saga: updatedSaga, failureReason, workOrder };
  }

  private async notifyCustomer(workOrder: WorkOrder): Promise<void> {
    try {
      await this.emailSender.send(
        this.buildEmailContent(workOrder.customer!, workOrder.number.toString()),
      );
    } catch {
      // The mailer adapter already logs the failure; the compensation stays committed.
    }
  }

  private buildEmailContent(customer: Customer, workOrderNumber: string): SendEmailInput {
    return {
      toEmail: customer.email.value,
      toName: customer.name,
      subject: `Orçamento da Ordem de Serviço ${workOrderNumber} - Estoque insuficiente`,
      message: {
        text:
          `Olá ${customer.name},\n\n` +
          `A aprovação do orçamento da Ordem de Serviço ${workOrderNumber} não foi concluída por falta de estoque de uma ou mais peças.\n` +
          `O orçamento voltou a aguardar sua aprovação e pode ser aprovado de novo quando o estoque for reposto.\n\n` +
          `Atenciosamente,\nEquipe da Oficina Mecânica`,
        html:
          `<p>Olá <strong>${customer.name}</strong>,</p>` +
          `<p>A aprovação do orçamento da Ordem de Serviço <strong>${workOrderNumber}</strong> não foi concluída por falta de estoque de uma ou mais peças.</p>` +
          `<p>O orçamento voltou a aguardar sua aprovação e pode ser aprovado de novo quando o estoque for reposto.</p>` +
          `<p>Atenciosamente,<br/>Equipe da Oficina Mecânica</p>`,
      },
    };
  }
}
