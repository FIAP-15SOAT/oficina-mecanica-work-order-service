import { StatusHistory } from '@domain/entities/status-history.entity';
import { IStatusHistoryRepository } from '@domain/interfaces/repositories/status-history.repository.interface';

import { IMetrics } from '@application/ports/output/services/metrics.service.interface';

import { BUSINESS_METRICS } from './business-metric.catalog';
import { measureWorkOrderDurations, WorkOrderDurations } from './work-order-duration';

export async function recordWorkOrderTransition(
  metrics: IMetrics,
  statusHistoryRepository: IStatusHistoryRepository,
  transition: StatusHistory | undefined,
): Promise<void> {
  if (!transition) {
    return;
  }

  try {
    const history = await statusHistoryRepository.findByWorkOrderId(transition.workOrderId);

    recordWorkOrderDurations(metrics, measureWorkOrderDurations(history, transition));
  } catch {
    return;
  }
}

export function recordWorkOrderDurations(metrics: IMetrics, durations: WorkOrderDurations): void {
  if (durations.dwell) {
    metrics.record(BUSINESS_METRICS.WORK_ORDER_STATUS_DURATION, durations.dwell.seconds, {
      workOrderStatus: durations.dwell.status,
    });
  }

  if (durations.diagnosisToCompletionSeconds !== undefined) {
    metrics.record(
      BUSINESS_METRICS.WORK_ORDER_DIAGNOSIS_TO_COMPLETION_DURATION,
      durations.diagnosisToCompletionSeconds,
      {},
    );
  }

  if (durations.leadTimeSeconds !== undefined) {
    metrics.record(BUSINESS_METRICS.WORK_ORDER_LEAD_TIME_DURATION, durations.leadTimeSeconds, {});
  }
}
