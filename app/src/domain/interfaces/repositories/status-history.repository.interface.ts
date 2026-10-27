import { StatusHistory } from '../../entities/status-history.entity';

export interface IStatusHistoryRepository {
  create(entry: StatusHistory): Promise<StatusHistory>;

  /**
   * Returns the history **in ascending chronological order** by `createdAt` —
   * oldest entry first.
   *
   * ⚠️ The order is part of the contract, not an implementation detail. The
   * per-status dwell calculation (`measureWorkOrderDurations`) depends on it at
   * both ends: dwell anchors on the **last** entry that opened the status, and
   * totals anchor on the **first**. An implementation that returns another
   * order breaks nothing visibly — it corrupts the durations silently, because
   * nothing in the data signals that the order changed.
   */
  findByWorkOrderId(workOrderId: string): Promise<StatusHistory[]>;
}
