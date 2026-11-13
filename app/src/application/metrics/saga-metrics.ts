import { SagaInstance } from '@domain/entities/saga-instance.entity';
import { SagaStatus } from '@domain/enums/saga-status.enum';
import { SagaType } from '@domain/enums/saga-type.enum';

import { BUSINESS_EVENTS } from '@application/logging/business-event.catalog';
import { BUSINESS_METRICS, SagaOutcome } from './business-metric.catalog';
import { toSeconds } from './work-order-duration';
import { ILogger } from '@application/ports/output/services/logger.service.interface';
import { IMetrics } from '@application/ports/output/services/metrics.service.interface';

export interface SagaTransitionContext {
  /** True when this transition created or reopened the saga. */
  started: boolean;
  workOrderNumber: string;
  missingItemCount?: number;
}

/** Emits the saga.* log line together with the metrics of a saga transition; call it after the commit. */
export function recordSagaTransition(
  logger: ILogger,
  metrics: IMetrics,
  saga: SagaInstance,
  { started, workOrderNumber, missingItemCount }: SagaTransitionContext,
): void {
  const fields = {
    sagaId: saga.id,
    sagaType: saga.type,
    sagaStatus: saga.status,
    ...(saga.type === SagaType.PAYMENT
      ? { paymentId: saga.correlationId }
      : { quoteId: saga.correlationId }),
    workOrderId: saga.workOrderId,
    workOrderNumber,
  };

  const sagaFailureReason = saga.failureReason ?? undefined;

  if (started) {
    logger.event(BUSINESS_EVENTS.SAGA_STARTED, fields);
    metrics.increment(BUSINESS_METRICS.SAGA_STARTED, { sagaType: saga.type });
  }

  switch (saga.status) {
    case SagaStatus.COMPENSATING:
      logger.event(BUSINESS_EVENTS.SAGA_COMPENSATION_STARTED, {
        ...fields,
        sagaFailureReason,
        missingItemCount,
      });
      return;
    case SagaStatus.COMPLETED:
      logger.event(BUSINESS_EVENTS.SAGA_COMPLETED, fields);
      recordSagaFinish(metrics, saga, 'completed');
      return;
    case SagaStatus.COMPENSATED:
      logger.event(BUSINESS_EVENTS.SAGA_COMPENSATED, { ...fields, sagaFailureReason });
      recordSagaFinish(metrics, saga, 'compensated');
      return;
    default:
      return;
  }
}

function recordSagaFinish(metrics: IMetrics, saga: SagaInstance, sagaOutcome: SagaOutcome): void {
  const attributes = { sagaType: saga.type, sagaOutcome };

  metrics.increment(BUSINESS_METRICS.SAGA_FINISHED, attributes);

  // shortcut: a reopened saga is timed from its creation, not from the reopening; store the reopening instant if the metric skews.
  const seconds = toSeconds(saga.createdAt, saga.updatedAt);

  if (seconds !== undefined) {
    metrics.record(BUSINESS_METRICS.SAGA_DURATION, seconds, attributes);
  }
}
