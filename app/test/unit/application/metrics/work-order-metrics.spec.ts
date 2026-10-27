import { BUSINESS_METRICS } from '@application/metrics/business-metric.catalog';
import {
  recordWorkOrderDurations,
  recordWorkOrderTransition,
} from '@application/metrics/work-order-metrics';
import { WorkOrderStatus } from '@domain/enums/work-order-status.enum';
import { IStatusHistoryRepository } from '@domain/interfaces/repositories/status-history.repository.interface';
import { createMockMetrics } from '../../../helpers/metrics-mock.factory';
import {
  createMockStatusHistory,
  createMockStatusHistoryRepository,
} from '../../../helpers/status-history-mock.factory';

const WORK_ORDER_ID = 'e2a1b0c4-0000-4000-8000-000000000000';

const RECEIVED = createMockStatusHistory({
  id: 'aaaaaaaa-0000-4000-8000-000000000001',
  workOrderId: WORK_ORDER_ID,
  previousStatus: null,
  newStatus: WorkOrderStatus.RECEIVED,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
});

const DIAGNOSED = createMockStatusHistory({
  id: 'aaaaaaaa-0000-4000-8000-000000000002',
  workOrderId: WORK_ORDER_ID,
  previousStatus: WorkOrderStatus.RECEIVED,
  newStatus: WorkOrderStatus.IN_DIAGNOSIS,
  createdAt: new Date('2026-01-01T01:00:00.000Z'),
});

describe('recordWorkOrderTransition', () => {
  let repository: jest.Mocked<IStatusHistoryRepository>;

  beforeEach(() => {
    repository = createMockStatusHistoryRepository([RECEIVED, DIAGNOSED]);
  });

  it('should measure from the history read by the repository, outside the transaction', async () => {
    const metrics = createMockMetrics();

    await recordWorkOrderTransition(metrics, repository, DIAGNOSED);

    expect(repository.findByWorkOrderId).toHaveBeenCalledWith(WORK_ORDER_ID);
    expect(metrics.record).toHaveBeenCalledWith(BUSINESS_METRICS.WORK_ORDER_STATUS_DURATION, 3600, {
      workOrderStatus: WorkOrderStatus.RECEIVED,
    });
  });

  it('should not read anything when there was no transition', async () => {
    const metrics = createMockMetrics();

    await recordWorkOrderTransition(metrics, repository, undefined);

    expect(repository.findByWorkOrderId).not.toHaveBeenCalled();
    expect(metrics.record).not.toHaveBeenCalled();
  });

  /**
   * The operation is already committed when this read happens: propagating the
   * failure would turn a successful write into an error because of telemetry.
   */
  it('should absorb a read failure without propagating', async () => {
    const metrics = createMockMetrics();

    repository.findByWorkOrderId.mockRejectedValue(new Error('conexão perdida'));

    await expect(
      recordWorkOrderTransition(metrics, repository, DIAGNOSED),
    ).resolves.toBeUndefined();
    expect(metrics.record).not.toHaveBeenCalled();
  });
});

describe('recordWorkOrderDurations', () => {
  it('should not emit anything when the transition closed no interval', () => {
    const metrics = createMockMetrics();

    recordWorkOrderDurations(metrics, {});

    expect(metrics.record).not.toHaveBeenCalled();
  });

  it('should emit the dwell with the left status as an attribute', () => {
    const metrics = createMockMetrics();

    recordWorkOrderDurations(metrics, {
      dwell: { status: WorkOrderStatus.APPROVED, seconds: 1800 },
    });

    expect(metrics.record).toHaveBeenCalledTimes(1);
    expect(metrics.record).toHaveBeenCalledWith(BUSINESS_METRICS.WORK_ORDER_STATUS_DURATION, 1800, {
      workOrderStatus: WorkOrderStatus.APPROVED,
    });
  });

  it('should emit both totals with no attributes', () => {
    const metrics = createMockMetrics();

    recordWorkOrderDurations(metrics, {
      diagnosisToCompletionSeconds: 7200,
      leadTimeSeconds: 86400,
    });

    expect(metrics.record).toHaveBeenCalledWith(
      BUSINESS_METRICS.WORK_ORDER_DIAGNOSIS_TO_COMPLETION_DURATION,
      7200,
      {},
    );
    expect(metrics.record).toHaveBeenCalledWith(
      BUSINESS_METRICS.WORK_ORDER_LEAD_TIME_DURATION,
      86400,
      {},
    );
  });

  /**
   * Zero is a legitimate observation — two transitions at the same database
   * instant — and treating it as "no value" would drop exactly the instant
   * passages from the distribution.
   */
  it('should emit a zero duration, which is a valid observation', () => {
    const metrics = createMockMetrics();

    recordWorkOrderDurations(metrics, {
      dwell: { status: WorkOrderStatus.RECEIVED, seconds: 0 },
      diagnosisToCompletionSeconds: 0,
    });

    expect(metrics.record).toHaveBeenCalledTimes(2);
  });
});
