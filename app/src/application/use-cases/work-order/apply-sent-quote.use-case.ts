import { StatusHistory } from '@domain/entities/status-history.entity';
import { WorkOrder } from '@domain/entities/work-order.entity';
import { WorkOrderStatus } from '@domain/enums/work-order-status.enum';
import { IStatusHistoryRepository } from '@domain/interfaces/repositories/status-history.repository.interface';
import { IRepositories, IUnitOfWork } from '@domain/interfaces/repositories/unit-of-work.interface';
import {
  CustomerEmailRecipient,
  CustomerEmailRecipients,
} from '@domain/services/customer-email-recipients';

import { workOrderCacheKey } from '@application/keys/work-order-cache-key';
import { BUSINESS_EVENTS } from '@application/logging/business-event.catalog';
import { recordWorkOrderTransition } from '@application/metrics/work-order-metrics';
import { IApplySentQuoteUseCase } from '@application/ports/input/work-order/apply-sent-quote.use-case.interface';
import { ApplySentQuoteInputDto } from '@application/ports/input/work-order/dto/apply-sent-quote.dto';
import { ICache } from '@application/ports/output/services/cache.service.interface';
import {
  IEmailSenderService,
  SendEmailInput,
} from '@application/ports/output/services/email-sender.service.interface';
import { ILogger } from '@application/ports/output/services/logger.service.interface';
import { IMetrics } from '@application/ports/output/services/metrics.service.interface';

type SentQuoteApplication =
  | { applied: false; currentWorkOrderStatus: WorkOrderStatus }
  | {
      applied: true;
      workOrderNumber: string;
      recipients: CustomerEmailRecipient[];
      workOrderStatusTransition?: StatusHistory;
    };

export class ApplySentQuoteUseCase implements IApplySentQuoteUseCase {
  constructor(
    private readonly unitOfWork: IUnitOfWork,
    private readonly emailSender: IEmailSenderService,
    private readonly logger: ILogger,
    private readonly metrics: IMetrics,
    private readonly statusHistoryRepository: IStatusHistoryRepository,
    private readonly cache: ICache,
  ) {}

  async execute(input: ApplySentQuoteInputDto): Promise<void> {
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

    const { workOrderNumber, recipients, workOrderStatusTransition } = application;

    if (workOrderStatusTransition) {
      await this.cache.delete([workOrderCacheKey(input.workOrderId)]);
    }

    await recordWorkOrderTransition(
      this.metrics,
      this.statusHistoryRepository,
      workOrderStatusTransition,
    );

    // The mailer adapter logs each failure; a lost e-mail does not undo the transition.
    await Promise.allSettled(
      recipients.map((recipient) =>
        this.emailSender.send(this.buildEmailContent(input, recipient, workOrderNumber)),
      ),
    );
  }

  private async apply(
    repos: IRepositories,
    { workOrderId, sentBy }: ApplySentQuoteInputDto,
  ): Promise<SentQuoteApplication> {
    const workOrder = (await repos.workOrder.findById(workOrderId))!;

    if (workOrder.status === WorkOrderStatus.AWAITING_APPROVAL) {
      return this.buildSentQuoteApplication(repos, workOrder);
    }

    // The work order may have changed (e.g. been cancelled) between the send and this event.
    if (!workOrder.canChangeStatusTo(WorkOrderStatus.AWAITING_APPROVAL)) {
      return { applied: false, currentWorkOrderStatus: workOrder.status };
    }

    const workOrderStatusTransition = await this.moveWorkOrderToAwaitingApproval(
      repos,
      workOrder,
      sentBy,
    );

    return this.buildSentQuoteApplication(repos, workOrder, workOrderStatusTransition);
  }

  private async buildSentQuoteApplication(
    repos: IRepositories,
    workOrder: WorkOrder,
    workOrderStatusTransition?: StatusHistory,
  ): Promise<SentQuoteApplication> {
    const customer = (await repos.customer.findById(workOrder.customerId))!;
    const linkedUsers = await repos.userCustomer.findUsersByCustomerId(customer.id);

    return {
      applied: true,
      workOrderNumber: workOrder.number.toString(),
      recipients: CustomerEmailRecipients.fromActiveLinkedUsersOrCustomer(customer, linkedUsers),
      workOrderStatusTransition,
    };
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

  private buildEmailContent(
    { total, items }: ApplySentQuoteInputDto,
    recipient: CustomerEmailRecipient,
    workOrderNumber: string,
  ): SendEmailInput {
    const instructionText = recipient.hasAccess
      ? 'Acesse o sistema autenticando com seu CPF e senha para aprovar ou rejeitar.'
      : 'Você ainda não possui acesso ao sistema. Entre em contato com a oficina para solicitar a criação do seu acesso e poder aprovar ou rejeitar este orçamento.';

    const instructionHtml = recipient.hasAccess
      ? '<p>Acesse o sistema autenticando com seu CPF e senha para aprovar ou rejeitar.</p>'
      : '<p>Você ainda não possui acesso ao sistema. <strong>Entre em contato com a oficina</strong> para solicitar a criação do seu acesso e poder aprovar ou rejeitar este orçamento.</p>';

    const itemLines = items.map((item) => `${item.name}: ${item.quantity} x R$ ${item.unitPrice}`);

    return {
      toEmail: recipient.email,
      toName: recipient.name,
      subject: `Orçamento para Ordem de Serviço ${workOrderNumber} - Aguardando sua aprovação`,
      message: {
        text:
          `Olá ${recipient.name},\n\n` +
          `Um orçamento para a Ordem de Serviço ${workOrderNumber} está disponível para sua aprovação.\n` +
          itemLines.map((line) => `${line}\n`).join('') +
          `Valor total: R$ ${total}\n\n` +
          `${instructionText}\n\n` +
          `Atenciosamente,\nEquipe da Oficina Mecânica`,
        html:
          `<p>Olá <strong>${recipient.name}</strong>,</p>` +
          `<p>Um orçamento para a Ordem de Serviço <strong>${workOrderNumber}</strong> está disponível para sua aprovação.</p>` +
          `<ul>${itemLines.map((line) => `<li>${line}</li>`).join('')}</ul>` +
          `<p><strong>Valor total:</strong> R$ ${total}</p>` +
          `${instructionHtml}` +
          `<p>Atenciosamente,<br/>Equipe da Oficina Mecânica</p>`,
      },
    };
  }
}
