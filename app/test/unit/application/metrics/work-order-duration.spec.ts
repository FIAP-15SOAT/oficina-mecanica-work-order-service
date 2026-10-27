import {
  measureWorkOrderDurations,
  WorkOrderDurations,
} from '@application/metrics/work-order-duration';
import { StatusHistory } from '@domain/entities/status-history.entity';
import { WorkOrder } from '@domain/entities/work-order.entity';
import { WorkOrderStatus } from '@domain/enums/work-order-status.enum';
import { createMockStatusHistory } from '../../../helpers/status-history-mock.factory';

const WORK_ORDER_ID = 'e2a1b0c4-0000-4000-8000-000000000000';

const HOUR_MS = 60 * 60 * 1000;

const BASE = new Date('2026-01-01T00:00:00.000Z');

let entryCount = 0;

function at(hours: number): Date {
  return new Date(BASE.getTime() + hours * HOUR_MS);
}

/**
 * The history arrives as the database returns it: ascending chronological
 * order, with the timestamp written by PostgreSQL. The last entry is the
 * current transition.
 */
function entry(
  previousStatus: WorkOrderStatus | null,
  newStatus: WorkOrderStatus,
  hours: number,
): StatusHistory {
  return createMockStatusHistory({
    // Each entry has its own identity: the current transition is found by id,
    // and a history of equal ids would make the calculation always anchor on the first.
    id: `e2a1b0c4-0000-4000-8000-${String(entryCount++).padStart(12, '0')}`,
    workOrderId: WORK_ORDER_ID,
    previousStatus,
    newStatus,
    createdAt: at(hours),
  });
}

/** The current transition is the last entry, as the database returns it. */
function measure(history: StatusHistory[]): WorkOrderDurations {
  return measureWorkOrderDurations(history, history[history.length - 1]);
}

describe('measureWorkOrderDurations', () => {
  /**
   * The read happens after the commit, so the history may have grown between
   * the write and the read. Without the current transition in it there is
   * nothing to anchor on, and measuring the last row would measure another
   * operation's interval.
   */
  it('should not measure anything when the current transition is not in the history', () => {
    const history = [entry(null, WorkOrderStatus.RECEIVED, 0)];

    expect(measureWorkOrderDurations(history, entry(null, WorkOrderStatus.RECEIVED, 1))).toEqual(
      {},
    );
  });

  it('should anchor on the given transition, not on the last history row', () => {
    const created = entry(null, WorkOrderStatus.RECEIVED, 0);
    const current = entry(WorkOrderStatus.RECEIVED, WorkOrderStatus.IN_DIAGNOSIS, 2);
    const concorrente = entry(WorkOrderStatus.IN_DIAGNOSIS, WorkOrderStatus.CANCELLED, 9);

    expect(measureWorkOrderDurations([created, current, concorrente], current).dwell).toEqual({
      status: WorkOrderStatus.RECEIVED,
      seconds: 2 * 3600,
    });
  });

  it('should not measure dwell on work order creation, which leaves no status', () => {
    expect(measure([entry(null, WorkOrderStatus.RECEIVED, 0)])).toEqual({});
  });

  it('should measure the dwell in the status left by the current transition', () => {
    const history = [
      entry(null, WorkOrderStatus.RECEIVED, 0),
      entry(WorkOrderStatus.RECEIVED, WorkOrderStatus.IN_DIAGNOSIS, 2),
    ];

    expect(measure(history).dwell).toEqual({
      status: WorkOrderStatus.RECEIVED,
      seconds: 2 * 3600,
    });
  });

  /**
   * `APPROVED` (waiting for a mechanic) and `COMPLETED` (ready, waiting for the
   * customer to pick up) are idle time the operation needs to see — and without
   * them the sum of the stages would not match the total service time.
   */
  it.each([
    [WorkOrderStatus.APPROVED, WorkOrderStatus.IN_PROGRESS],
    [WorkOrderStatus.IN_PROGRESS, WorkOrderStatus.COMPLETED],
    [WorkOrderStatus.COMPLETED, WorkOrderStatus.DELIVERED],
  ])('should measure the passive wait in %s', (previous, next) => {
    const history = [entry(null, previous, 0), entry(previous, next, 5)];

    expect(measure(history).dwell?.status).toBe(previous);
  });

  /**
   * `REJECTED` is not terminal: the state machine declares
   * `REJECTED -> AWAITING_APPROVAL`, and that wait is exactly the one that hurts most.
   */
  it('should measure the dwell when leaving REJECTED', () => {
    const history = [
      entry(null, WorkOrderStatus.RECEIVED, 0),
      entry(WorkOrderStatus.RECEIVED, WorkOrderStatus.IN_DIAGNOSIS, 1),
      entry(WorkOrderStatus.IN_DIAGNOSIS, WorkOrderStatus.AWAITING_APPROVAL, 2),
      entry(WorkOrderStatus.AWAITING_APPROVAL, WorkOrderStatus.REJECTED, 3),
      entry(WorkOrderStatus.REJECTED, WorkOrderStatus.AWAITING_APPROVAL, 9),
    ];

    expect(measure(history).dwell).toEqual({
      status: WorkOrderStatus.REJECTED,
      seconds: 6 * 3600,
    });
  });

  it('should treat as terminal exactly the statuses with no outgoing transition', () => {
    expect(WorkOrder.isTerminalStatus(WorkOrderStatus.DELIVERED)).toBe(true);
    expect(WorkOrder.isTerminalStatus(WorkOrderStatus.CANCELLED)).toBe(true);
    expect(WorkOrder.isTerminalStatus(WorkOrderStatus.REJECTED)).toBe(false);
  });

  /**
   * The regression this test prevents is silent and proportional to rework:
   * anchoring on the first occurrence would report all the time since the
   * first pass, inflating the distribution exactly where the metric should
   * expose the problem.
   */
  it('should measure the last pass, not the accumulation since the first entry', () => {
    const history = [
      entry(null, WorkOrderStatus.RECEIVED, 0),
      entry(WorkOrderStatus.RECEIVED, WorkOrderStatus.IN_DIAGNOSIS, 1),
      entry(WorkOrderStatus.IN_DIAGNOSIS, WorkOrderStatus.AWAITING_APPROVAL, 2),
      entry(WorkOrderStatus.AWAITING_APPROVAL, WorkOrderStatus.REJECTED, 10),
      entry(WorkOrderStatus.REJECTED, WorkOrderStatus.AWAITING_APPROVAL, 12),
      entry(WorkOrderStatus.AWAITING_APPROVAL, WorkOrderStatus.APPROVED, 15),
    ];

    expect(measure(history).dwell).toEqual({
      status: WorkOrderStatus.AWAITING_APPROVAL,
      seconds: 3 * 3600,
    });
  });

  describe('totals', () => {
    const fullCycle = (deliveredAt = 30) => [
      entry(null, WorkOrderStatus.RECEIVED, 0),
      entry(WorkOrderStatus.RECEIVED, WorkOrderStatus.IN_DIAGNOSIS, 1),
      entry(WorkOrderStatus.IN_DIAGNOSIS, WorkOrderStatus.AWAITING_APPROVAL, 3),
      entry(WorkOrderStatus.AWAITING_APPROVAL, WorkOrderStatus.APPROVED, 8),
      entry(WorkOrderStatus.APPROVED, WorkOrderStatus.IN_PROGRESS, 12),
      entry(WorkOrderStatus.IN_PROGRESS, WorkOrderStatus.COMPLETED, 20),
      entry(WorkOrderStatus.COMPLETED, WorkOrderStatus.DELIVERED, deliveredAt),
    ];

    it('should record the execution time on completion, starting from diagnosis', () => {
      const untilCompleted = fullCycle().slice(0, -1);

      const durations = measure(untilCompleted);

      expect(durations.diagnosisToCompletionSeconds).toBe(19 * 3600);
      expect(durations.leadTimeSeconds).toBeUndefined();
    });

    it('should record the service time on delivery, starting from reception', () => {
      const durations = measure(fullCycle());

      expect(durations.leadTimeSeconds).toBe(30 * 3600);
      expect(durations.diagnosisToCompletionSeconds).toBeUndefined();
    });

    /**
     * Totals anchor on the **first** entry, while dwell anchors on the last:
     * two different lookup rules in the same function, and the distinction is
     * what keeps the dashboard auditable when there was rework.
     */
    it('should anchor totals on the first entry, even with re-entry in between', () => {
      const history = [
        entry(null, WorkOrderStatus.RECEIVED, 0),
        entry(WorkOrderStatus.RECEIVED, WorkOrderStatus.IN_DIAGNOSIS, 1),
        entry(WorkOrderStatus.IN_DIAGNOSIS, WorkOrderStatus.AWAITING_APPROVAL, 2),
        entry(WorkOrderStatus.AWAITING_APPROVAL, WorkOrderStatus.REJECTED, 4),
        entry(WorkOrderStatus.REJECTED, WorkOrderStatus.AWAITING_APPROVAL, 10),
        entry(WorkOrderStatus.AWAITING_APPROVAL, WorkOrderStatus.APPROVED, 12),
        entry(WorkOrderStatus.APPROVED, WorkOrderStatus.IN_PROGRESS, 14),
        entry(WorkOrderStatus.IN_PROGRESS, WorkOrderStatus.COMPLETED, 18),
      ];

      expect(measure(history).diagnosisToCompletionSeconds).toBe(17 * 3600);
    });

    it('should not produce any total when the order is cancelled midway', () => {
      const history = [
        entry(null, WorkOrderStatus.RECEIVED, 0),
        entry(WorkOrderStatus.RECEIVED, WorkOrderStatus.IN_DIAGNOSIS, 1),
        entry(WorkOrderStatus.IN_DIAGNOSIS, WorkOrderStatus.CANCELLED, 4),
      ];

      const durations = measure(history);

      expect(durations.diagnosisToCompletionSeconds).toBeUndefined();
      expect(durations.leadTimeSeconds).toBeUndefined();
      expect(durations.dwell?.status).toBe(WorkOrderStatus.IN_DIAGNOSIS);
    });

    it('should not produce a total when the opening status is absent from the history', () => {
      const history = [
        entry(null, WorkOrderStatus.IN_PROGRESS, 0),
        entry(WorkOrderStatus.IN_PROGRESS, WorkOrderStatus.COMPLETED, 2),
      ];

      expect(measure(history).diagnosisToCompletionSeconds).toBeUndefined();
    });

    it('should not produce a total when the opening timestamp is invalid', () => {
      const history = [
        createMockStatusHistory({
          workOrderId: WORK_ORDER_ID,
          previousStatus: null,
          newStatus: WorkOrderStatus.RECEIVED,
          createdAt: new Date('data-invalida'),
        }),
        entry(WorkOrderStatus.RECEIVED, WorkOrderStatus.COMPLETED, 1),
        entry(WorkOrderStatus.COMPLETED, WorkOrderStatus.DELIVERED, 2),
      ];

      expect(measure(history).leadTimeSeconds).toBeUndefined();
    });
  });

  describe('time source', () => {
    /**
     * Both ends come from the persisted timestamp — never from the process
     * clock. Mixing clocks would produce wrong durations and, under pod↔RDS
     * skew, negative ones: the SDK drops them with a warning, without failing.
     */
    it('should derive the duration from the history timestamps, not the process clock', () => {
      const now = jest.spyOn(Date, 'now');

      const history = [
        entry(null, WorkOrderStatus.RECEIVED, 0),
        entry(WorkOrderStatus.RECEIVED, WorkOrderStatus.IN_DIAGNOSIS, 7),
      ];

      expect(measure(history).dwell?.seconds).toBe(7 * 3600);
      expect(now).not.toHaveBeenCalled();

      now.mockRestore();
    });

    /**
     * Truncated history (retention, partial import): without the entry into
     * the left status there is no interval, and inventing one from the first
     * available row would measure something else.
     */
    it('should not measure dwell when the entry into the left status is absent from the history', () => {
      const history = [
        entry(WorkOrderStatus.APPROVED, WorkOrderStatus.IN_PROGRESS, 3),
        entry(WorkOrderStatus.IN_PROGRESS, WorkOrderStatus.COMPLETED, 9),
      ];

      expect(measure(history).dwell?.status).toBe(WorkOrderStatus.IN_PROGRESS);

      const orphan = [entry(WorkOrderStatus.APPROVED, WorkOrderStatus.IN_PROGRESS, 3)];

      expect(measure(orphan).dwell).toBeUndefined();
    });

    it('should not measure dwell when the history keeps only rows into other statuses', () => {
      const history = [
        entry(WorkOrderStatus.RECEIVED, WorkOrderStatus.IN_DIAGNOSIS, 1),
        entry(WorkOrderStatus.APPROVED, WorkOrderStatus.IN_PROGRESS, 3),
      ];

      expect(measure(history).dwell).toBeUndefined();
    });

    it('should not emit a duration when a timestamp is invalid', () => {
      const history = [
        createMockStatusHistory({
          workOrderId: WORK_ORDER_ID,
          previousStatus: null,
          newStatus: WorkOrderStatus.RECEIVED,
          createdAt: new Date('data-invalida'),
        }),
        entry(WorkOrderStatus.RECEIVED, WorkOrderStatus.IN_DIAGNOSIS, 2),
      ];

      expect(measure(history).dwell).toBeUndefined();
    });

    it('should not emit a negative duration when the timestamps are out of order', () => {
      const history = [
        entry(null, WorkOrderStatus.RECEIVED, 5),
        entry(WorkOrderStatus.RECEIVED, WorkOrderStatus.IN_DIAGNOSIS, 1),
      ];

      expect(measure(history).dwell).toBeUndefined();
    });
  });
});
