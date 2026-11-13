import { randomUUID } from 'node:crypto';

import { PaymentOriginStatus, WorkOrder } from '@domain/entities/work-order.entity';
import { SagaFailureReason } from '@domain/enums/saga-failure-reason.enum';
import { SagaStatus } from '@domain/enums/saga-status.enum';
import { SagaType } from '@domain/enums/saga-type.enum';
import { WorkOrderStatus } from '@domain/enums/work-order-status.enum';
import { IRepositories, IUnitOfWork } from '@domain/interfaces/repositories/unit-of-work.interface';

import { workOrderCacheKey } from '@application/keys/work-order-cache-key';
import { BUSINESS_EVENTS } from '@application/logging/business-event.catalog';
import { BUSINESS_METRICS } from '@application/metrics/business-metric.catalog';
import { PaymentFailureReason } from '@application/ports/input/payment/dto/apply-payment-result.dto';
import { ICache } from '@application/ports/output/services/cache.service.interface';
import { ILogger } from '@application/ports/output/services/logger.service.interface';
import { IMetrics } from '@application/ports/output/services/metrics.service.interface';
import { ApplyPaymentResultUseCase } from '@application/use-cases/payment/apply-payment-result.use-case';

import { createMockCache } from '../../../../helpers/cache-mock.factory';
import { createMockLogger } from '../../../../helpers/logger-mock.factory';
import { createMockMetrics } from '../../../../helpers/metrics-mock.factory';
import { createMockSagaInstance } from '../../../../helpers/saga-instance-mock.factory';
import {
  arrangeStatusHistory,
  createMockStatusHistory,
} from '../../../../helpers/status-history-mock.factory';
import { createMockUnitOfWorkWithRepos } from '../../../../helpers/unit-of-work-mock.factory';
import { createMockWorkOrder } from '../../../../helpers/work-order-mock.factory';

describe('ApplyPaymentResultUseCase', () => {
  let useCase: ApplyPaymentResultUseCase;
  let unitOfWork: jest.Mocked<IUnitOfWork>;
  let repos: jest.Mocked<IRepositories>;
  let logger: jest.Mocked<ILogger>;
  let metrics: jest.Mocked<IMetrics>;
  let cache: jest.Mocked<ICache>;
  let workOrder: WorkOrder;
  let paymentId: string;

  beforeEach(() => {
    ({ unitOfWork, repos } = createMockUnitOfWorkWithRepos());

    logger = createMockLogger();

    metrics = createMockMetrics();

    cache = createMockCache();

    workOrder = createMockWorkOrder({ status: WorkOrderStatus.AWAITING_PAYMENT });

    paymentId = randomUUID();

    jest.mocked(repos.workOrder.findById).mockResolvedValue(workOrder);

    useCase = new ApplyPaymentResultUseCase(
      unitOfWork,
      logger,
      metrics,
      repos.statusHistory,
      cache,
    );
  });

  it.each([WorkOrderStatus.APPROVED, WorkOrderStatus.COMPLETED] as PaymentOriginStatus[])(
    'should return the work order to its origin and complete the saga when the payment is approved (origin %s)',
    async (originStatus) => {
      jest.mocked(repos.sagaInstance.findByTypeAndCorrelationId).mockResolvedValue(
        createMockSagaInstance({
          type: SagaType.PAYMENT,
          correlationId: paymentId,
          workOrderId: workOrder.id,
          status: SagaStatus.AWAITING_PAYMENT,
          originStatus,
        }),
      );

      arrangeStatusHistory(
        repos.statusHistory,
        [
          createMockStatusHistory({
            workOrderId: workOrder.id,
            previousStatus: originStatus,
            newStatus: WorkOrderStatus.AWAITING_PAYMENT,
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
          }),
        ],
        new Date('2026-01-01T00:30:00.000Z'),
      );

      await useCase.execute({ paymentId, outcome: 'approved' });

      expect(repos.sagaInstance.findByTypeAndCorrelationId).toHaveBeenCalledWith(
        SagaType.PAYMENT,
        paymentId,
      );

      expect(repos.workOrder.findById).toHaveBeenCalledWith(workOrder.id);
      expect(workOrder.status).toBe(originStatus);
      expect(repos.workOrder.update).toHaveBeenCalledWith(workOrder);

      expect(repos.sagaInstance.update).toHaveBeenCalledWith(
        expect.objectContaining({ status: SagaStatus.COMPLETED, failureReason: null }),
      );

      expect(repos.statusHistory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          workOrderId: workOrder.id,
          changedById: null,
          previousStatus: WorkOrderStatus.AWAITING_PAYMENT,
          newStatus: originStatus,
          notes: `Cobrança ${paymentId} paga`,
        }),
      );

      expect(logger.event).toHaveBeenCalledTimes(1);
      expect(logger.event).toHaveBeenCalledWith(BUSINESS_EVENTS.SAGA_COMPLETED, {
        sagaId: expect.any(String),
        sagaType: SagaType.PAYMENT,
        sagaStatus: SagaStatus.COMPLETED,
        paymentId,
        workOrderId: workOrder.id,
        workOrderNumber: workOrder.number.toString(),
      });

      expect(metrics.increment).toHaveBeenCalledWith(BUSINESS_METRICS.SAGA_FINISHED, {
        sagaType: SagaType.PAYMENT,
        sagaOutcome: 'completed',
      });
      expect(metrics.record).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'work_order.status.duration' }),
        30 * 60,
        { workOrderStatus: WorkOrderStatus.AWAITING_PAYMENT },
      );
    },
  );

  it.each([
    ['EXPIRED', SagaFailureReason.PAYMENT_EXPIRED, 'expirada'],
    ['REJECTED', SagaFailureReason.PAYMENT_REJECTED, 'recusada'],
    ['CANCELLED', SagaFailureReason.PAYMENT_CANCELLED, 'cancelada'],
  ] as [PaymentFailureReason, SagaFailureReason, string][])(
    'should return the work order to its origin and compensate the saga with the payment failure reason (%s)',
    async (reason, sagaFailureReason, outcomeNote) => {
      jest.mocked(repos.sagaInstance.findByTypeAndCorrelationId).mockResolvedValue(
        createMockSagaInstance({
          type: SagaType.PAYMENT,
          correlationId: paymentId,
          workOrderId: workOrder.id,
          status: SagaStatus.AWAITING_PAYMENT,
          originStatus: WorkOrderStatus.COMPLETED,
        }),
      );

      await useCase.execute({ paymentId, outcome: 'failed', reason });

      expect(workOrder.status).toBe(WorkOrderStatus.COMPLETED);
      expect(repos.workOrder.update).toHaveBeenCalledWith(workOrder);

      expect(repos.sagaInstance.update).toHaveBeenCalledWith(
        expect.objectContaining({
          status: SagaStatus.COMPENSATED,
          failureReason: sagaFailureReason,
        }),
      );

      expect(repos.statusHistory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          changedById: null,
          previousStatus: WorkOrderStatus.AWAITING_PAYMENT,
          newStatus: WorkOrderStatus.COMPLETED,
          notes: `Cobrança ${paymentId} ${outcomeNote}`,
        }),
      );

      expect(logger.event).toHaveBeenCalledWith(
        BUSINESS_EVENTS.SAGA_COMPENSATED,
        expect.objectContaining({ paymentId, sagaFailureReason }),
      );
    },
  );

  it('should compensate a compensating saga without touching the work order', async () => {
    const startedWorkOrder = createMockWorkOrder({ status: WorkOrderStatus.IN_PROGRESS });

    jest.mocked(repos.workOrder.findById).mockResolvedValue(startedWorkOrder);

    jest.mocked(repos.sagaInstance.findByTypeAndCorrelationId).mockResolvedValue(
      createMockSagaInstance({
        type: SagaType.PAYMENT,
        correlationId: paymentId,
        workOrderId: startedWorkOrder.id,
        status: SagaStatus.COMPENSATING,
        failureReason: SagaFailureReason.WORK_ORDER_NOT_PAYABLE,
      }),
    );

    await useCase.execute({ paymentId, outcome: 'failed', reason: 'CANCELLED' });

    expect(startedWorkOrder.status).toBe(WorkOrderStatus.IN_PROGRESS);
    expect(repos.workOrder.update).not.toHaveBeenCalled();
    expect(repos.statusHistory.create).not.toHaveBeenCalled();
    expect(cache.delete).not.toHaveBeenCalled();
    expect(metrics.record).toHaveBeenCalledTimes(1);

    expect(repos.sagaInstance.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: SagaStatus.COMPENSATED,
        failureReason: SagaFailureReason.WORK_ORDER_NOT_PAYABLE,
      }),
    );

    expect(logger.event).toHaveBeenCalledWith(BUSINESS_EVENTS.SAGA_COMPENSATED, {
      sagaId: expect.any(String),
      sagaType: SagaType.PAYMENT,
      sagaStatus: SagaStatus.COMPENSATED,
      paymentId,
      workOrderId: startedWorkOrder.id,
      workOrderNumber: startedWorkOrder.number.toString(),
      sagaFailureReason: SagaFailureReason.WORK_ORDER_NOT_PAYABLE,
    });
  });

  it('should complete a compensating saga without touching the work order when the payment was approved', async () => {
    const startedWorkOrder = createMockWorkOrder({ status: WorkOrderStatus.IN_PROGRESS });

    jest.mocked(repos.workOrder.findById).mockResolvedValue(startedWorkOrder);

    jest.mocked(repos.sagaInstance.findByTypeAndCorrelationId).mockResolvedValue(
      createMockSagaInstance({
        type: SagaType.PAYMENT,
        correlationId: paymentId,
        workOrderId: startedWorkOrder.id,
        status: SagaStatus.COMPENSATING,
        failureReason: SagaFailureReason.WORK_ORDER_NOT_PAYABLE,
      }),
    );

    await useCase.execute({ paymentId, outcome: 'approved' });

    expect(startedWorkOrder.status).toBe(WorkOrderStatus.IN_PROGRESS);
    expect(repos.workOrder.update).not.toHaveBeenCalled();
    expect(repos.statusHistory.create).not.toHaveBeenCalled();
    expect(cache.delete).not.toHaveBeenCalled();

    expect(repos.sagaInstance.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: SagaStatus.COMPLETED,
        failureReason: SagaFailureReason.WORK_ORDER_NOT_PAYABLE,
      }),
    );

    expect(logger.event).toHaveBeenCalledWith(
      BUSINESS_EVENTS.SAGA_COMPLETED,
      expect.objectContaining({ paymentId, sagaStatus: SagaStatus.COMPLETED }),
    );
  });

  it.each([undefined, SagaStatus.COMPLETED, SagaStatus.COMPENSATED])(
    'should skip a result for an unknown or settled saga (saga status %s)',
    async (sagaStatus) => {
      jest
        .mocked(repos.sagaInstance.findByTypeAndCorrelationId)
        .mockResolvedValue(
          sagaStatus
            ? createMockSagaInstance({ type: SagaType.PAYMENT, status: sagaStatus })
            : null,
        );

      await useCase.execute({ paymentId, outcome: 'approved' });

      expect(repos.workOrder.findById).not.toHaveBeenCalled();
      expect(repos.workOrder.update).not.toHaveBeenCalled();
      expect(repos.sagaInstance.update).not.toHaveBeenCalled();
      expect(repos.statusHistory.create).not.toHaveBeenCalled();
      expect(cache.delete).not.toHaveBeenCalled();
      expect(metrics.increment).not.toHaveBeenCalled();

      expect(logger.event).toHaveBeenCalledWith(BUSINESS_EVENTS.SAGA_STEP_SKIPPED, {
        sagaType: SagaType.PAYMENT,
        paymentId,
        sagaStatus,
      });
    },
  );

  it('should delete the work order cache key only when the work order changed', async () => {
    const steps: string[] = [];

    jest.mocked(repos.sagaInstance.findByTypeAndCorrelationId).mockResolvedValue(
      createMockSagaInstance({
        type: SagaType.PAYMENT,
        correlationId: paymentId,
        workOrderId: workOrder.id,
        status: SagaStatus.AWAITING_PAYMENT,
        originStatus: WorkOrderStatus.APPROVED,
      }),
    );

    unitOfWork.executeTransaction.mockImplementation(async (work) => {
      const result = await work(repos);

      steps.push('commit');

      return result;
    });

    cache.delete.mockImplementation(() => {
      steps.push('cache.delete');

      return Promise.resolve();
    });

    await useCase.execute({ paymentId, outcome: 'approved' });

    expect(steps).toEqual(['commit', 'cache.delete']);
    expect(cache.delete).toHaveBeenCalledWith([workOrderCacheKey(workOrder.id)]);
  });
});
