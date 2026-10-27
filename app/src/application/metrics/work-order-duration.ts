import { StatusHistory } from '@domain/entities/status-history.entity';
import { WorkOrder } from '@domain/entities/work-order.entity';
import { WorkOrderStatus } from '@domain/enums/work-order-status.enum';

const MILLISECONDS_PER_SECOND = 1_000;

export interface WorkOrderStatusDwell {
  status: WorkOrderStatus;
  seconds: number;
}

export interface WorkOrderDurations {
  /** Time spent in the status this transition left. */
  dwell?: WorkOrderStatusDwell;
  /** `IN_DIAGNOSIS -> COMPLETED`, recorded only once, on completion. */
  diagnosisToCompletionSeconds?: number;
  /** `RECEIVED -> DELIVERED`, recorded only once, on delivery. */
  leadTimeSeconds?: number;
}

export function measureWorkOrderDurations(
  history: readonly StatusHistory[],
  transition: StatusHistory,
): WorkOrderDurations {
  const index = history.findIndex((entry) => entry.id === transition.id);

  if (index === -1) {
    return {};
  }

  const current = history[index];
  const endedAt = current.createdAt;
  const upToCurrent = history.slice(0, index + 1);

  return {
    ...buildDwell(history.slice(0, index), current, endedAt),
    ...buildTotal(
      upToCurrent,
      endedAt,
      current.newStatus,
      WorkOrderStatus.COMPLETED,
      WorkOrderStatus.IN_DIAGNOSIS,
      'diagnosisToCompletionSeconds',
    ),
    ...buildTotal(
      upToCurrent,
      endedAt,
      current.newStatus,
      WorkOrderStatus.DELIVERED,
      WorkOrderStatus.RECEIVED,
      'leadTimeSeconds',
    ),
  };
}

function buildDwell(
  preceding: readonly StatusHistory[],
  transition: StatusHistory,
  endedAt: Date,
): WorkOrderDurations {
  const status = transition.previousStatus;

  if (!status || WorkOrder.isTerminalStatus(status)) {
    return {};
  }

  const entered = findLastEntryInto(preceding, status);

  if (!entered) {
    return {};
  }

  const seconds = toSeconds(entered.createdAt, endedAt);

  return seconds === undefined ? {} : { dwell: { status, seconds } };
}

function buildTotal(
  history: readonly StatusHistory[],
  endedAt: Date,
  newStatus: WorkOrderStatus,
  closingStatus: WorkOrderStatus,
  openingStatus: WorkOrderStatus,
  key: 'diagnosisToCompletionSeconds' | 'leadTimeSeconds',
): WorkOrderDurations {
  if (newStatus !== closingStatus) {
    return {};
  }

  const opened = findFirstEntryInto(history, openingStatus);

  if (!opened) {
    return {};
  }

  const seconds = toSeconds(opened.createdAt, endedAt);

  return seconds === undefined ? {} : { [key]: seconds };
}

function findLastEntryInto(
  history: readonly StatusHistory[],
  status: WorkOrderStatus,
): StatusHistory | undefined {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (history[index].newStatus === status) {
      return history[index];
    }
  }

  return undefined;
}

function findFirstEntryInto(
  history: readonly StatusHistory[],
  status: WorkOrderStatus,
): StatusHistory | undefined {
  return history.find((entry) => entry.newStatus === status);
}

function toSeconds(start: Date, end: Date): number | undefined {
  const elapsed = end.getTime() - start.getTime();

  if (!Number.isFinite(elapsed) || elapsed < 0) {
    return undefined;
  }

  return elapsed / MILLISECONDS_PER_SECOND;
}
