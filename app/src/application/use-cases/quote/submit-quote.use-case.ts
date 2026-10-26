import { Quote } from '@domain/entities/quote.entity';
import { Customer } from '@domain/entities/customer.entity';
import { StatusHistory } from '@domain/entities/status-history.entity';
import { WorkOrder } from '@domain/entities/work-order.entity';

import { WorkOrderStatus } from '@domain/enums/work-order-status.enum';

import { ILogger } from '@application/ports/output/logger.service.interface';
import { IMetrics } from '@application/ports/output/metrics.service.interface';
import { BUSINESS_EVENTS } from '@application/logging/business-event.catalog';
import { recordWorkOrderTransition } from '@application/metrics/work-order-metrics';
import { IRepositories, IUnitOfWork } from '@domain/interfaces/repositories/unit-of-work.interface';
import { IStatusHistoryRepository } from '@domain/interfaces/repositories/status-history.repository.interface';
import {
  IEmailSenderService,
  SendEmailInput,
} from '@application/ports/output/email-sender.service.interface';

import { ResourceNotFoundException } from '@application/exceptions/resource-not-found.exception';
import { ICache } from '@application/ports/output/cache.service.interface';
import { workOrderCacheKey } from '@application/keys/work-order-cache-key';

interface QuoteRecipient {
  email: string;
  name: string;
  hasAccess: boolean;
}

export class SubmitQuoteUseCase {
  constructor(
    private readonly unitOfWork: IUnitOfWork,
    private readonly emailSender: IEmailSenderService,
    private readonly logger: ILogger,
    private readonly metrics: IMetrics,
    private readonly statusHistoryRepository: IStatusHistoryRepository,
    private readonly cache: ICache,
  ) {}

  async execute(quoteId: string): Promise<Quote> {
    const {
      quote: submittedQuote,
      workOrderId,
      workOrderNumber,
      previousQuoteStatus,
      transition,
    } = await this.unitOfWork.executeTransaction(async (repos) => {
      const quote = await repos.quote.findByIdWithDetails(quoteId);

      if (!quote) {
        throw new ResourceNotFoundException('Orçamento', quoteId);
      }

      const workOrder = (await repos.workOrder.findById(quote.workOrderId))!;

      workOrder.ensureCanSubmitQuote();

      const previousQuoteStatus = quote.status;

      quote.submit();

      const customer = (await repos.customer.findById(workOrder.customerId))!;

      const [updatedQuote, transition] = await Promise.all([
        repos.quote.update(quote),
        this.applyWorkOrderTransition(repos, workOrder),
      ]);

      updatedQuote.workOrder = workOrder;

      await this.sendEmailNotification(repos, quote, customer, workOrder.number.toString());

      return {
        quote: updatedQuote,
        workOrderId: workOrder.id,
        workOrderNumber: workOrder.number.toString(),
        previousQuoteStatus,
        transition,
      };
    });

    await this.cache.delete([workOrderCacheKey(workOrderId)]);

    this.logger.event(BUSINESS_EVENTS.QUOTE_SUBMITTED, {
      quoteId: submittedQuote.id,
      previousQuoteStatus,
      workOrderId,
      workOrderNumber,
    });

    await recordWorkOrderTransition(this.metrics, this.statusHistoryRepository, transition);

    return submittedQuote;
  }

  private async applyWorkOrderTransition(
    repos: IRepositories,
    workOrder: WorkOrder,
  ): Promise<StatusHistory | undefined> {
    if (
      workOrder.status !== WorkOrderStatus.IN_DIAGNOSIS &&
      workOrder.status !== WorkOrderStatus.REJECTED
    ) {
      return undefined;
    }

    const previousStatus = workOrder.status;
    workOrder.changeStatus(WorkOrderStatus.AWAITING_APPROVAL);

    const [, transition] = await Promise.all([
      repos.workOrder.update(workOrder),
      repos.statusHistory.create(
        StatusHistory.create({
          workOrderId: workOrder.id,
          previousStatus,
          newStatus: WorkOrderStatus.AWAITING_APPROVAL,
        }),
      ),
    ]);

    return transition;
  }

  private async sendEmailNotification(
    repos: IRepositories,
    quote: Quote,
    customer: Customer,
    workOrderNumber: string,
  ): Promise<void> {
    const recipients = await this.resolveRecipients(repos, customer);

    await Promise.all(
      recipients.map((recipient) =>
        this.emailSender.send(this.buildEmailContent(quote, recipient, workOrderNumber)),
      ),
    );
  }

  private async resolveRecipients(
    repos: IRepositories,
    customer: Customer,
  ): Promise<QuoteRecipient[]> {
    const linkedUsers = await repos.userCustomer.findUsersByCustomerId(customer.id);
    const activeLinkedUsers = linkedUsers.filter((user) => user.isActive);

    if (activeLinkedUsers.length === 0) {
      return [{ email: customer.email.value, name: customer.name, hasAccess: false }];
    }

    return activeLinkedUsers.map((user) => ({
      email: user.email.value,
      name: user.name,
      hasAccess: true,
    }));
  }

  private buildEmailContent(
    quote: Quote,
    recipient: QuoteRecipient,
    workOrderNumber: string,
  ): SendEmailInput {
    const instructionText = recipient.hasAccess
      ? 'Acesse o sistema autenticando com seu CPF e senha para aprovar ou rejeitar.'
      : 'Você ainda não possui acesso ao sistema. Entre em contato com a oficina para solicitar a criação do seu acesso e poder aprovar ou rejeitar este orçamento.';

    const instructionHtml = recipient.hasAccess
      ? '<p>Acesse o sistema autenticando com seu CPF e senha para aprovar ou rejeitar.</p>'
      : '<p>Você ainda não possui acesso ao sistema. <strong>Entre em contato com a oficina</strong> para solicitar a criação do seu acesso e poder aprovar ou rejeitar este orçamento.</p>';

    return {
      toEmail: recipient.email,
      toName: recipient.name,
      subject: `Orçamento para Ordem de Serviço ${workOrderNumber} - Aguardando sua aprovação`,
      message: {
        text:
          `Olá ${recipient.name},\n\n` +
          `Um orçamento para a Ordem de Serviço ${workOrderNumber} está disponível para sua aprovação.\n` +
          `Valor total: R$ ${quote.totalAmount.toFixed(2)}\n\n` +
          `${instructionText}\n\n` +
          `Atenciosamente,\nEquipe da Oficina Mecânica`,
        html:
          `<p>Olá <strong>${recipient.name}</strong>,</p>` +
          `<p>Um orçamento para a Ordem de Serviço <strong>${workOrderNumber}</strong> está disponível para sua aprovação.</p>` +
          `<p><strong>Valor total:</strong> R$ ${quote.totalAmount.toFixed(2)}</p>` +
          `${instructionHtml}` +
          `<p>Atenciosamente,<br/>Equipe da Oficina Mecânica</p>`,
      },
    };
  }
}
