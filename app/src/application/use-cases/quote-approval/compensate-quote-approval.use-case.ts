import { Customer } from '@domain/entities/customer.entity';
import { Quote } from '@domain/entities/quote.entity';
import { SagaInstance } from '@domain/entities/saga-instance.entity';
import { StatusHistory } from '@domain/entities/status-history.entity';
import { WorkOrder } from '@domain/entities/work-order.entity';
import { SagaFailureReason } from '@domain/enums/saga-failure-reason.enum';
import { SagaStatus } from '@domain/enums/saga-status.enum';
import { SagaType } from '@domain/enums/saga-type.enum';

import { IRepositories, IUnitOfWork } from '@domain/interfaces/repositories/unit-of-work.interface';
import { IStatusHistoryRepository } from '@domain/interfaces/repositories/status-history.repository.interface';
import { ILogger } from '@application/ports/output/services/logger.service.interface';
import {
  IEmailSenderService,
  SendEmailInput,
} from '@application/ports/output/services/email-sender.service.interface';
import { BUSINESS_EVENTS } from '@application/logging/business-event.catalog';
import { ICompensateQuoteApprovalUseCase } from '@application/ports/input/quote-approval/compensate-quote-approval.use-case.interface';
import { CompensateQuoteApprovalInputDto } from '@application/ports/input/quote-approval/dto/compensate-quote-approval.dto';

type ApprovalCompensation =
  | { compensated: false; sagaStatus?: SagaStatus }
  | { compensated: true; saga: SagaInstance; workOrder: WorkOrder };

export class CompensateQuoteApprovalUseCase implements ICompensateQuoteApprovalUseCase {
  constructor(
    private readonly unitOfWork: IUnitOfWork,
    private readonly logger: ILogger,
    private readonly emailSender: IEmailSenderService,
  ) {}

  async execute({ quoteId, missingItemCount }: CompensateQuoteApprovalInputDto): Promise<void> {
    const compensation = await this.unitOfWork.executeTransaction((repos) =>
      this.compensate(repos, quoteId),
    );

    if (!compensation.compensated) {
      this.logger.event(BUSINESS_EVENTS.QUOTE_APPROVAL_STEP_SKIPPED, {
        quoteId,
        sagaStatus: compensation.sagaStatus,
      });

      return;
    }

    const { saga, workOrder } = compensation;

    this.logger.event(BUSINESS_EVENTS.QUOTE_APPROVAL_COMPENSATED, {
      sagaId: saga.id,
      quoteId,
      workOrderId: workOrder.id,
      workOrderNumber: workOrder.number.toString(),
      missingItemCount,
    });

    await this.notifyCustomer(workOrder);
  }

  private async compensate(repos: IRepositories, quoteId: string): Promise<ApprovalCompensation> {
    const saga = await repos.sagaInstance.findByTypeAndCorrelationId(
      SagaType.QUOTE_APPROVAL,
      quoteId,
    );

    // A duplicated or late reply finds the saga already settled; at-least-once delivery makes it expected.
    if (saga?.status !== SagaStatus.RESERVING_STOCK) {
      return { compensated: false, sagaStatus: saga?.status };
    }

    const quote = (await repos.quote.findById(quoteId))!;
    const workOrder = (await repos.workOrder.findByIdWithDetails(saga.workOrderId))!;

    quote.revertApproval();

    const restoredQuotes = this.undoRejectionsByApproval(
      quote,
      await repos.quote.findByWorkOrderId(workOrder.id),
    );

    saga.compensate(SagaFailureReason.INSUFFICIENT_STOCK);

    await repos.quote.update(quote);
    await Promise.all(restoredQuotes.map((restoredQuote) => repos.quote.update(restoredQuote)));
    await repos.sagaInstance.update(saga);
    await this.recordCompensation(repos.statusHistory, workOrder, quoteId);

    return { compensated: true, saga, workOrder };
  }

  private undoRejectionsByApproval(revertedQuote: Quote, workOrderQuotes: Quote[]): Quote[] {
    const replacedQuotes = workOrderQuotes.filter(
      (other) => other.replacedByQuoteId === revertedQuote.id,
    );

    replacedQuotes.forEach((replacedQuote) => replacedQuote.undoRejectionByApproval());

    return replacedQuotes;
  }

  private async recordCompensation(
    statusHistoryRepository: IStatusHistoryRepository,
    workOrder: WorkOrder,
    quoteId: string,
  ): Promise<void> {
    await statusHistoryRepository.create(
      StatusHistory.create({
        workOrderId: workOrder.id,
        changedById: null,
        previousStatus: workOrder.status,
        newStatus: workOrder.status,
        notes: `Aprovação do orçamento ${quoteId} desfeita por falta de estoque`,
      }),
    );
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
