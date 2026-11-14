import { SagaInstance } from '@domain/entities/saga-instance.entity';
import { StatusHistory } from '@domain/entities/status-history.entity';
import { PaymentOriginStatus, WorkOrder } from '@domain/entities/work-order.entity';
import { SagaFailureReason } from '@domain/enums/saga-failure-reason.enum';
import { SagaStatus } from '@domain/enums/saga-status.enum';
import { SagaType } from '@domain/enums/saga-type.enum';
import { WorkOrderStatus } from '@domain/enums/work-order-status.enum';
import { IStatusHistoryRepository } from '@domain/interfaces/repositories/status-history.repository.interface';
import { IRepositories, IUnitOfWork } from '@domain/interfaces/repositories/unit-of-work.interface';

import { workOrderCacheKey } from '@application/keys/work-order-cache-key';
import { BUSINESS_EVENTS } from '@application/logging/business-event.catalog';
import { recordSagaTransition } from '@application/metrics/saga-metrics';
import { recordWorkOrderTransition } from '@application/metrics/work-order-metrics';
import { WorkOrderEmailComposer } from '@application/notifications/work-order-email.composer';
import { StartPaymentInputDto } from '@application/ports/input/payment/dto/start-payment.dto';
import { IStartPaymentUseCase } from '@application/ports/input/payment/start-payment.use-case.interface';
import { ICache } from '@application/ports/output/services/cache.service.interface';
import { ILogger } from '@application/ports/output/services/logger.service.interface';
import { IMetrics } from '@application/ports/output/services/metrics.service.interface';
import {
  CustomerEmailRecipient,
  CustomerEmailRecipientsResolver,
} from '@application/services/customer-email-recipients';

type PaymentStart =
  | { outcome: 'skipped'; sagaStatus: SagaStatus }
  | { outcome: 'cancellation_requested'; saga: SagaInstance; workOrderNumber: string }
  | {
      outcome: 'held';
      saga: SagaInstance;
      workOrderNumber: string;
      workOrderStatusTransition: StatusHistory;
    };

export class StartPaymentUseCase implements IStartPaymentUseCase {
  constructor(
    private readonly unitOfWork: IUnitOfWork,
    private readonly recipientsResolver: CustomerEmailRecipientsResolver,
    private readonly logger: ILogger,
    private readonly metrics: IMetrics,
    private readonly statusHistoryRepository: IStatusHistoryRepository,
    private readonly cache: ICache,
  ) {}

  async execute(input: StartPaymentInputDto): Promise<void> {
    const recipients = await this.recipientsResolver.resolveForWorkOrder(input.workOrderId);

    const start = await this.unitOfWork.executeTransaction((repos) =>
      this.start(repos, input, recipients),
    );

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
  }

  private async start(
    repos: IRepositories,
    input: StartPaymentInputDto,
    recipients: CustomerEmailRecipient[],
  ): Promise<PaymentStart> {
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

    return this.holdWorkOrder(repos, workOrder, input, recipients);
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
    { paymentId, amount, checkoutUrl, expiresAt }: StartPaymentInputDto,
    recipients: CustomerEmailRecipient[],
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

    for (const recipient of recipients) {
      await repos.outbox.add(
        WorkOrderEmailComposer.paymentLink({
          recipient,
          workOrderId: workOrder.id,
          workOrderNumber: workOrder.number.toString(),
          amount,
          checkoutUrl,
          expiresAt,
        }),
      );
    }

    return {
      outcome: 'held',
      saga,
      workOrderNumber: workOrder.number.toString(),
      workOrderStatusTransition,
    };
  }
}
