import { SagaInstance } from '@domain/entities/saga-instance.entity';
import { StatusHistory } from '@domain/entities/status-history.entity';
import { SagaFailureReason } from '@domain/enums/saga-failure-reason.enum';
import { SagaStatus } from '@domain/enums/saga-status.enum';
import { SagaType } from '@domain/enums/saga-type.enum';
import { IStatusHistoryRepository } from '@domain/interfaces/repositories/status-history.repository.interface';
import { IRepositories, IUnitOfWork } from '@domain/interfaces/repositories/unit-of-work.interface';

import { workOrderCacheKey } from '@application/keys/work-order-cache-key';
import { BUSINESS_EVENTS } from '@application/logging/business-event.catalog';
import { recordSagaTransition } from '@application/metrics/saga-metrics';
import { recordWorkOrderTransition } from '@application/metrics/work-order-metrics';
import { IApplyPaymentResultUseCase } from '@application/ports/input/payment/apply-payment-result.use-case.interface';
import {
  ApplyPaymentResultInputDto,
  PaymentFailureReason,
} from '@application/ports/input/payment/dto/apply-payment-result.dto';
import { ICache } from '@application/ports/output/services/cache.service.interface';
import { ILogger } from '@application/ports/output/services/logger.service.interface';
import { IMetrics } from '@application/ports/output/services/metrics.service.interface';

type PaymentResultApplication =
  | { outcome: 'skipped'; sagaStatus?: SagaStatus }
  | { outcome: 'compensation_closed'; saga: SagaInstance; workOrderNumber: string }
  | {
      outcome: 'released';
      saga: SagaInstance;
      workOrderNumber: string;
      workOrderStatusTransition: StatusHistory;
    };

const PAYMENT_FAILURES: Record<
  PaymentFailureReason,
  { sagaFailureReason: SagaFailureReason; note: string }
> = {
  EXPIRED: { sagaFailureReason: SagaFailureReason.PAYMENT_EXPIRED, note: 'expirada' },
  REJECTED: { sagaFailureReason: SagaFailureReason.PAYMENT_REJECTED, note: 'recusada' },
  CANCELLED: { sagaFailureReason: SagaFailureReason.PAYMENT_CANCELLED, note: 'cancelada' },
};

export class ApplyPaymentResultUseCase implements IApplyPaymentResultUseCase {
  constructor(
    private readonly unitOfWork: IUnitOfWork,
    private readonly logger: ILogger,
    private readonly metrics: IMetrics,
    private readonly statusHistoryRepository: IStatusHistoryRepository,
    private readonly cache: ICache,
  ) {}

  async execute(input: ApplyPaymentResultInputDto): Promise<void> {
    const application = await this.unitOfWork.executeTransaction((repos) =>
      this.apply(repos, input),
    );

    if (application.outcome === 'skipped') {
      this.logger.event(BUSINESS_EVENTS.SAGA_STEP_SKIPPED, {
        sagaType: SagaType.PAYMENT,
        paymentId: input.paymentId,
        sagaStatus: application.sagaStatus,
      });

      return;
    }

    if (application.outcome === 'released') {
      await this.cache.delete([workOrderCacheKey(application.saga.workOrderId)]);
    }

    recordSagaTransition(this.logger, this.metrics, application.saga, {
      started: false,
      workOrderNumber: application.workOrderNumber,
    });

    if (application.outcome === 'released') {
      await recordWorkOrderTransition(
        this.metrics,
        this.statusHistoryRepository,
        application.workOrderStatusTransition,
      );
    }
  }

  private async apply(
    repos: IRepositories,
    input: ApplyPaymentResultInputDto,
  ): Promise<PaymentResultApplication> {
    const saga = await repos.sagaInstance.findByTypeAndCorrelationId(
      SagaType.PAYMENT,
      input.paymentId,
    );

    if (saga?.status === SagaStatus.AWAITING_PAYMENT) {
      return this.releaseWorkOrder(repos, saga, input);
    }

    if (saga?.status === SagaStatus.COMPENSATING) {
      return this.closeCompensation(repos, saga, input);
    }

    // A duplicated or late result finds the saga missing or settled; at-least-once delivery makes it expected.
    return { outcome: 'skipped', sagaStatus: saga?.status };
  }

  private async releaseWorkOrder(
    repos: IRepositories,
    saga: SagaInstance,
    input: ApplyPaymentResultInputDto,
  ): Promise<PaymentResultApplication> {
    const workOrder = (await repos.workOrder.findById(saga.workOrderId))!;

    const previousStatus = workOrder.status;

    // A saga awaiting payment always stores the status the hold came from.
    workOrder.releasePaymentHold(saga.originStatus!);

    if (input.outcome === 'approved') {
      saga.complete();
    } else {
      saga.compensate(PAYMENT_FAILURES[input.reason].sagaFailureReason);
    }

    await repos.workOrder.update(workOrder);
    const updatedSaga = await repos.sagaInstance.update(saga);

    const outcomeNote = input.outcome === 'approved' ? 'paga' : PAYMENT_FAILURES[input.reason].note;

    const workOrderStatusTransition = await repos.statusHistory.create(
      StatusHistory.create({
        workOrderId: workOrder.id,
        previousStatus,
        newStatus: workOrder.status,
        notes: `Cobrança ${input.paymentId} ${outcomeNote}`,
      }),
    );

    return {
      outcome: 'released',
      saga: updatedSaga,
      workOrderNumber: workOrder.number.toString(),
      workOrderStatusTransition,
    };
  }

  private async closeCompensation(
    repos: IRepositories,
    saga: SagaInstance,
    { outcome }: ApplyPaymentResultInputDto,
  ): Promise<PaymentResultApplication> {
    // The work order moved on before the hold; it is read only for its number.
    const workOrder = (await repos.workOrder.findById(saga.workOrderId))!;

    if (outcome === 'approved') {
      saga.complete();
    } else {
      saga.compensate();
    }

    const updatedSaga = await repos.sagaInstance.update(saga);

    return {
      outcome: 'compensation_closed',
      saga: updatedSaga,
      workOrderNumber: workOrder.number.toString(),
    };
  }
}
