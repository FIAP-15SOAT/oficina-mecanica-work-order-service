import { BUSINESS_EVENTS } from '@application/logging/business-event.catalog';
import { BUSINESS_METRICS } from '@application/metrics/business-metric.catalog';
import { ILogger } from '@application/ports/output/services/logger.service.interface';
import { IMetrics } from '@application/ports/output/services/metrics.service.interface';
import { recordSagaTransition } from '@application/metrics/saga-metrics';
import { SagaFailureReason } from '@domain/enums/saga-failure-reason.enum';
import { SagaStatus } from '@domain/enums/saga-status.enum';
import { SagaType } from '@domain/enums/saga-type.enum';
import { createMockLogger } from '../../../helpers/logger-mock.factory';
import { createMockMetrics } from '../../../helpers/metrics-mock.factory';
import { createMockSagaInstance } from '../../../helpers/saga-instance-mock.factory';

const WORK_ORDER_NUMBER = 'OS-2026-0001';

describe('recordSagaTransition', () => {
  let logger: jest.Mocked<ILogger>;
  let metrics: jest.Mocked<IMetrics>;

  beforeEach(() => {
    logger = createMockLogger();

    metrics = createMockMetrics();
  });

  it('should log saga.started and count the start for a saga that starts waiting', () => {
    const saga = createMockSagaInstance({ status: SagaStatus.RESERVING_STOCK });

    recordSagaTransition(logger, metrics, saga, {
      started: true,
      workOrderNumber: WORK_ORDER_NUMBER,
    });

    expect(logger.event).toHaveBeenCalledTimes(1);
    expect(logger.event).toHaveBeenCalledWith(BUSINESS_EVENTS.SAGA_STARTED, {
      sagaId: saga.id,
      sagaType: SagaType.QUOTE_APPROVAL,
      sagaStatus: saga.status,
      quoteId: saga.correlationId,
      workOrderId: saga.workOrderId,
      workOrderNumber: WORK_ORDER_NUMBER,
    });

    expect(metrics.increment).toHaveBeenCalledWith(BUSINESS_METRICS.SAGA_STARTED, {
      sagaType: SagaType.QUOTE_APPROVAL,
    });

    expect(metrics.record).not.toHaveBeenCalled();
  });

  it('should log the start and saga.compensation.started with the failure reason for a saga that starts compensating', () => {
    const saga = createMockSagaInstance({
      status: SagaStatus.COMPENSATING,
      failureReason: SagaFailureReason.WORK_ORDER_NOT_AWAITING,
    });

    recordSagaTransition(logger, metrics, saga, {
      started: true,
      workOrderNumber: WORK_ORDER_NUMBER,
    });

    expect(logger.event).toHaveBeenNthCalledWith(
      1,
      BUSINESS_EVENTS.SAGA_STARTED,
      expect.objectContaining({ sagaId: saga.id }),
    );

    expect(logger.event).toHaveBeenNthCalledWith(2, BUSINESS_EVENTS.SAGA_COMPENSATION_STARTED, {
      sagaId: saga.id,
      sagaType: SagaType.QUOTE_APPROVAL,
      sagaStatus: saga.status,
      quoteId: saga.correlationId,
      workOrderId: saga.workOrderId,
      workOrderNumber: WORK_ORDER_NUMBER,
      sagaFailureReason: SagaFailureReason.WORK_ORDER_NOT_AWAITING,
      missingItemCount: undefined,
    });
    expect(metrics.increment).toHaveBeenCalledTimes(1);
  });

  it('should log saga.compensation.started with the missing item count for a saga already started', () => {
    const saga = createMockSagaInstance({
      status: SagaStatus.COMPENSATING,
      failureReason: SagaFailureReason.INSUFFICIENT_STOCK,
    });

    recordSagaTransition(logger, metrics, saga, {
      started: false,
      workOrderNumber: WORK_ORDER_NUMBER,
      missingItemCount: 2,
    });

    expect(logger.event).toHaveBeenCalledTimes(1);
    expect(logger.event).toHaveBeenCalledWith(
      BUSINESS_EVENTS.SAGA_COMPENSATION_STARTED,
      expect.objectContaining({
        sagaFailureReason: SagaFailureReason.INSUFFICIENT_STOCK,
        missingItemCount: 2,
      }),
    );
    expect(metrics.increment).not.toHaveBeenCalled();
  });

  it('should log saga.completed, count the completed finish and record the duration', () => {
    const saga = createMockSagaInstance({
      status: SagaStatus.COMPLETED,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:30.000Z'),
    });

    recordSagaTransition(logger, metrics, saga, {
      started: false,
      workOrderNumber: WORK_ORDER_NUMBER,
    });

    expect(logger.event).toHaveBeenCalledWith(BUSINESS_EVENTS.SAGA_COMPLETED, {
      sagaId: saga.id,
      sagaType: SagaType.QUOTE_APPROVAL,
      sagaStatus: saga.status,
      quoteId: saga.correlationId,
      workOrderId: saga.workOrderId,
      workOrderNumber: WORK_ORDER_NUMBER,
    });
    expect(metrics.increment).toHaveBeenCalledWith(BUSINESS_METRICS.SAGA_FINISHED, {
      sagaType: SagaType.QUOTE_APPROVAL,
      sagaOutcome: 'completed',
    });
    expect(metrics.record).toHaveBeenCalledWith(BUSINESS_METRICS.SAGA_DURATION, 30, {
      sagaType: SagaType.QUOTE_APPROVAL,
      sagaOutcome: 'completed',
    });
  });

  it('should log saga.compensated with the failure reason, count the compensated finish and record the duration', () => {
    const saga = createMockSagaInstance({
      type: SagaType.PAYMENT,
      status: SagaStatus.COMPENSATED,
      failureReason: SagaFailureReason.PAYMENT_EXPIRED,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:02:00.000Z'),
    });

    recordSagaTransition(logger, metrics, saga, {
      started: false,
      workOrderNumber: WORK_ORDER_NUMBER,
    });

    expect(logger.event).toHaveBeenCalledWith(BUSINESS_EVENTS.SAGA_COMPENSATED, {
      sagaId: saga.id,
      sagaType: SagaType.PAYMENT,
      sagaStatus: SagaStatus.COMPENSATED,
      paymentId: saga.correlationId,
      workOrderId: saga.workOrderId,
      workOrderNumber: WORK_ORDER_NUMBER,
      sagaFailureReason: SagaFailureReason.PAYMENT_EXPIRED,
    });
    expect(metrics.increment).toHaveBeenCalledWith(BUSINESS_METRICS.SAGA_FINISHED, {
      sagaType: SagaType.PAYMENT,
      sagaOutcome: 'compensated',
    });
    expect(metrics.record).toHaveBeenCalledWith(BUSINESS_METRICS.SAGA_DURATION, 120, {
      sagaType: SagaType.PAYMENT,
      sagaOutcome: 'compensated',
    });
  });

  it('should carry the quote id for an approval saga and the payment id for a payment saga', () => {
    const approval = createMockSagaInstance({ type: SagaType.QUOTE_APPROVAL });
    const payment = createMockSagaInstance({
      type: SagaType.PAYMENT,
      status: SagaStatus.AWAITING_PAYMENT,
    });

    recordSagaTransition(logger, metrics, approval, {
      started: true,
      workOrderNumber: WORK_ORDER_NUMBER,
    });
    recordSagaTransition(logger, metrics, payment, {
      started: true,
      workOrderNumber: WORK_ORDER_NUMBER,
    });

    const [[, approvalFields], [, paymentFields]] = logger.event.mock.calls;

    expect(approvalFields).toMatchObject({ quoteId: approval.correlationId });
    expect(approvalFields).not.toHaveProperty('paymentId');
    expect(paymentFields).toMatchObject({ paymentId: payment.correlationId });
    expect(paymentFields).not.toHaveProperty('quoteId');
  });

  it('should skip the duration when the timestamps are out of order', () => {
    const saga = createMockSagaInstance({
      status: SagaStatus.COMPLETED,
      createdAt: new Date('2026-01-01T00:01:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    recordSagaTransition(logger, metrics, saga, {
      started: false,
      workOrderNumber: WORK_ORDER_NUMBER,
    });

    expect(metrics.increment).toHaveBeenCalledWith(
      BUSINESS_METRICS.SAGA_FINISHED,
      expect.anything(),
    );
    expect(metrics.record).not.toHaveBeenCalled();
  });
});
