import { SagaInstance } from '@domain/entities/saga-instance.entity';
import { StatusHistory } from '@domain/entities/status-history.entity';
import { PaymentOriginStatus, WorkOrder } from '@domain/entities/work-order.entity';
import { SagaFailureReason } from '@domain/enums/saga-failure-reason.enum';
import { SagaStatus } from '@domain/enums/saga-status.enum';
import { SagaType } from '@domain/enums/saga-type.enum';
import { WorkOrderStatus } from '@domain/enums/work-order-status.enum';
import { IStatusHistoryRepository } from '@domain/interfaces/repositories/status-history.repository.interface';
import { IRepositories, IUnitOfWork } from '@domain/interfaces/repositories/unit-of-work.interface';
import {
  CustomerEmailRecipient,
  CustomerEmailRecipients,
} from '@domain/services/customer-email-recipients';

import { workOrderCacheKey } from '@application/keys/work-order-cache-key';
import { BUSINESS_EVENTS } from '@application/logging/business-event.catalog';
import { recordSagaTransition } from '@application/metrics/saga-metrics';
import { recordWorkOrderTransition } from '@application/metrics/work-order-metrics';
import { StartPaymentInputDto } from '@application/ports/input/payment/dto/start-payment.dto';
import { IStartPaymentUseCase } from '@application/ports/input/payment/start-payment.use-case.interface';
import { ICache } from '@application/ports/output/services/cache.service.interface';
import {
  IEmailSenderService,
  SendEmailInput,
} from '@application/ports/output/services/email-sender.service.interface';
import { ILogger } from '@application/ports/output/services/logger.service.interface';
import { IMetrics } from '@application/ports/output/services/metrics.service.interface';

type PaymentStart =
  | { outcome: 'skipped'; sagaStatus: SagaStatus }
  | { outcome: 'cancellation_requested'; saga: SagaInstance; workOrderNumber: string }
  | {
      outcome: 'held';
      saga: SagaInstance;
      workOrderNumber: string;
      recipients: CustomerEmailRecipient[];
      workOrderStatusTransition: StatusHistory;
    };

export class StartPaymentUseCase implements IStartPaymentUseCase {
  constructor(
    private readonly unitOfWork: IUnitOfWork,
    private readonly emailSender: IEmailSenderService,
    private readonly logger: ILogger,
    private readonly metrics: IMetrics,
    private readonly statusHistoryRepository: IStatusHistoryRepository,
    private readonly cache: ICache,
  ) {}

  async execute(input: StartPaymentInputDto): Promise<void> {
    const start = await this.unitOfWork.executeTransaction((repos) => this.start(repos, input));

    if (start.outcome === 'skipped') {
      this.logger.event(BUSINESS_EVENTS.SAGA_STEP_SKIPPED, {
        sagaType: SagaType.PAYMENT,
        paymentId: input.paymentId,
        sagaStatus: start.sagaStatus,
      });

      return;
    }

    if (start.outcome === 'held') {
      await this.cache.delete([workOrderCacheKey(input.workOrderId)]);
    }

    recordSagaTransition(this.logger, this.metrics, start.saga, {
      started: true,
      workOrderNumber: start.workOrderNumber,
    });

    if (start.outcome !== 'held') {
      return;
    }

    await recordWorkOrderTransition(
      this.metrics,
      this.statusHistoryRepository,
      start.workOrderStatusTransition,
    );

    // The mailer adapter logs each failure; a lost e-mail does not undo the hold.
    await Promise.allSettled(
      start.recipients.map((recipient) =>
        this.emailSender.send(this.buildEmailContent(input, recipient, start.workOrderNumber)),
      ),
    );
  }

  private async start(repos: IRepositories, input: StartPaymentInputDto): Promise<PaymentStart> {
    const saga = await repos.sagaInstance.findByTypeAndCorrelationId(
      SagaType.PAYMENT,
      input.paymentId,
    );

    if (saga) {
      return { outcome: 'skipped', sagaStatus: saga.status };
    }

    const workOrder = (await repos.workOrder.findById(input.workOrderId))!;

    // The work order may have moved (e.g. started) between the payment creation and this event.
    if (!workOrder.canChangeStatusTo(WorkOrderStatus.AWAITING_PAYMENT)) {
      return this.requestPaymentCancellation(repos, workOrder, input);
    }

    return this.holdWorkOrder(repos, workOrder, input);
  }

  private async requestPaymentCancellation(
    repos: IRepositories,
    workOrder: WorkOrder,
    { paymentId }: StartPaymentInputDto,
  ): Promise<PaymentStart> {
    // Updating the work order with its version orders its outbox rows against concurrent writes.
    await repos.workOrder.update(workOrder);

    const saga = await repos.sagaInstance.create(
      SagaInstance.create({
        type: SagaType.PAYMENT,
        correlationId: paymentId,
        workOrderId: workOrder.id,
        status: SagaStatus.COMPENSATING,
        failureReason: SagaFailureReason.WORK_ORDER_NOT_PAYABLE,
      }),
    );

    await repos.outbox.add({
      type: 'billing.payment.cancel',
      workOrderId: workOrder.id,
      payload: { paymentId, reason: SagaFailureReason.WORK_ORDER_NOT_PAYABLE },
    });

    return {
      outcome: 'cancellation_requested',
      saga,
      workOrderNumber: workOrder.number.toString(),
    };
  }

  private async holdWorkOrder(
    repos: IRepositories,
    workOrder: WorkOrder,
    { paymentId }: StartPaymentInputDto,
  ): Promise<PaymentStart> {
    // Only APPROVED and COMPLETED reach AWAITING_PAYMENT, as checked by the caller.
    const originStatus = workOrder.status as PaymentOriginStatus;

    workOrder.holdForPayment();

    await repos.workOrder.update(workOrder);

    const saga = await repos.sagaInstance.create(
      SagaInstance.create({
        type: SagaType.PAYMENT,
        correlationId: paymentId,
        workOrderId: workOrder.id,
        status: SagaStatus.AWAITING_PAYMENT,
        originStatus,
      }),
    );

    const workOrderStatusTransition = await repos.statusHistory.create(
      StatusHistory.create({
        workOrderId: workOrder.id,
        previousStatus: originStatus,
        newStatus: WorkOrderStatus.AWAITING_PAYMENT,
        notes: `Aguardando o pagamento da cobrança ${paymentId}`,
      }),
    );

    const customer = (await repos.customer.findById(workOrder.customerId))!;
    const linkedUsers = await repos.userCustomer.findUsersByCustomerId(customer.id);

    return {
      outcome: 'held',
      saga,
      workOrderNumber: workOrder.number.toString(),
      recipients: CustomerEmailRecipients.fromActiveLinkedUsersOrCustomer(customer, linkedUsers),
      workOrderStatusTransition,
    };
  }

  private buildEmailContent(
    { amount, checkoutUrl, expiresAt }: StartPaymentInputDto,
    recipient: CustomerEmailRecipient,
    workOrderNumber: string,
  ): SendEmailInput {
    const expiresAtText = new Date(expiresAt).toLocaleString('pt-BR', {
      dateStyle: 'short',
      timeStyle: 'short',
      timeZone: 'America/Sao_Paulo',
    });

    // The serialized URL percent-encodes quotes, so the link cannot break out of the href.
    const checkoutLink = new URL(checkoutUrl).href;

    return {
      toEmail: recipient.email,
      toName: recipient.name,
      subject: `Pagamento da Ordem de Serviço ${workOrderNumber}`,
      message: {
        text:
          `Olá ${recipient.name},\n\n` +
          `O pagamento da Ordem de Serviço ${workOrderNumber} está disponível.\n` +
          `Valor: R$ ${amount}\n` +
          `Link para pagamento: ${checkoutLink}\n` +
          `Válido até ${expiresAtText}\n\n` +
          `Atenciosamente,\nEquipe da Oficina Mecânica`,
        html:
          `<p>Olá <strong>${recipient.name}</strong>,</p>` +
          `<p>O pagamento da Ordem de Serviço <strong>${workOrderNumber}</strong> está disponível.</p>` +
          `<p><strong>Valor:</strong> R$ ${amount}</p>` +
          `<p><a href="${checkoutLink}">Pagar agora</a> (válido até ${expiresAtText})</p>` +
          `<p>Atenciosamente,<br/>Equipe da Oficina Mecânica</p>`,
      },
    };
  }
}
