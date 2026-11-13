import { CompleteQuoteApprovalUseCase } from '@application/use-cases/quote-approval/complete-quote-approval.use-case';
import { WorkOrderStatus } from '@domain/enums/work-order-status.enum';
import { SagaType } from '@domain/enums/saga-type.enum';
import { SagaStatus } from '@domain/enums/saga-status.enum';
import { createMockWorkOrder } from '../../../../helpers/work-order-mock.factory';
import {
  createMockSagaInstance,
  createMockSagaInstanceRepository,
} from '../../../../helpers/saga-instance-mock.factory';
import { createMockUnitOfWorkWithRepos } from '../../../../helpers/unit-of-work-mock.factory';
import { IUnitOfWork, IRepositories } from '@domain/interfaces/repositories/unit-of-work.interface';
import { ISagaInstanceRepository } from '@domain/interfaces/repositories/saga-instance.repository.interface';
import { IBillingQuotesGateway } from '@application/ports/output/gateways/billing/billing-quotes-gateway.interface';
import { ILogger } from '@application/ports/output/services/logger.service.interface';
import { createMockLogger } from '../../../../helpers/logger-mock.factory';
import { IMetrics } from '@application/ports/output/services/metrics.service.interface';
import { createMockMetrics } from '../../../../helpers/metrics-mock.factory';
import {
  arrangeStatusHistory,
  createMockStatusHistory,
} from '../../../../helpers/status-history-mock.factory';
import { ICache } from '@application/ports/output/services/cache.service.interface';
import { workOrderCacheKey } from '@application/keys/work-order-cache-key';
import { createMockCache } from '../../../../helpers/cache-mock.factory';
import {
  createMockBillingQuotesGateway,
  readInternalQuoteFixture,
} from '../../../../helpers/billing-quotes-gateway-mock.factory';
import { BUSINESS_EVENTS } from '@application/logging/business-event.catalog';
import { BUSINESS_METRICS } from '@application/metrics/business-metric.catalog';
import { ServiceIntegrationException } from '@infrastructure/exceptions/service-integration.exception';

describe('CompleteQuoteApprovalUseCase', () => {
  let useCase: CompleteQuoteApprovalUseCase;
  let sagaInstanceRepository: jest.Mocked<ISagaInstanceRepository>;
  let billingQuotesGateway: jest.Mocked<IBillingQuotesGateway>;
  let unitOfWork: jest.Mocked<IUnitOfWork>;
  let repos: jest.Mocked<IRepositories>;
  let logger: jest.Mocked<ILogger>;
  let metrics: jest.Mocked<IMetrics>;
  let cache: jest.Mocked<ICache>;

  beforeEach(() => {
    sagaInstanceRepository = createMockSagaInstanceRepository();

    billingQuotesGateway = createMockBillingQuotesGateway();

    ({ unitOfWork, repos } = createMockUnitOfWorkWithRepos());

    logger = createMockLogger();

    metrics = createMockMetrics();

    cache = createMockCache();

    useCase = new CompleteQuoteApprovalUseCase(
      sagaInstanceRepository,
      billingQuotesGateway,
      unitOfWork,
      logger,
      metrics,
      repos.statusHistory,
      cache,
    );
  });

  it('should approve the work order with the items, total and author of the approved quote read in the Billing', async () => {
    const quote = readInternalQuoteFixture().data;

    const workOrder = createMockWorkOrder({
      id: quote.workOrderId,
      status: WorkOrderStatus.AWAITING_APPROVAL,
    });

    const saga = createMockSagaInstance({
      correlationId: quote.id,
      workOrderId: workOrder.id,
      status: SagaStatus.RESERVING_STOCK,
    });

    sagaInstanceRepository.findByTypeAndCorrelationId.mockResolvedValue(saga);

    billingQuotesGateway.getQuote.mockResolvedValue(quote);

    jest.mocked(repos.workOrder.findByIdWithDetails).mockResolvedValue(workOrder);

    arrangeStatusHistory(
      repos.statusHistory,
      [
        createMockStatusHistory({
          workOrderId: workOrder.id,
          previousStatus: WorkOrderStatus.IN_DIAGNOSIS,
          newStatus: WorkOrderStatus.AWAITING_APPROVAL,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
        }),
      ],
      new Date('2026-01-01T02:00:00.000Z'),
    );

    await useCase.execute(quote.id);

    expect(sagaInstanceRepository.findByTypeAndCorrelationId).toHaveBeenCalledWith(
      SagaType.QUOTE_APPROVAL,
      quote.id,
    );

    expect(billingQuotesGateway.getQuote).toHaveBeenCalledWith(quote.id);
    expect(repos.workOrder.findByIdWithDetails).toHaveBeenCalledWith(saga.workOrderId);
    expect(workOrder.status).toBe(WorkOrderStatus.APPROVED);
    expect(workOrder.totalAmount).toBe(quote.totalAmount);

    expect(repos.workOrder.addServiceItems).toHaveBeenCalledWith([
      expect.objectContaining({
        serviceId: quote.services[0].id,
        quantity: quote.services[0].quantity,
        unitPrice: quote.services[0].unitPrice,
      }),
    ]);

    expect(repos.workOrder.addPartSupplyItems).toHaveBeenCalledWith([
      expect.objectContaining({
        partSupplyId: quote.partsSupplies[0].id,
        quantity: quote.partsSupplies[0].quantity,
        unitPrice: quote.partsSupplies[0].unitPrice,
      }),
    ]);

    expect(repos.statusHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        workOrderId: workOrder.id,
        changedById: quote.decidedBy,
        previousStatus: WorkOrderStatus.AWAITING_APPROVAL,
        newStatus: WorkOrderStatus.APPROVED,
      }),
    );

    expect(saga.status).toBe(SagaStatus.COMPLETED);
    expect(repos.sagaInstance.update).toHaveBeenCalledWith(saga);
    expect(jest.mocked(repos.workOrder.update).mock.invocationCallOrder[0]).toBeLessThan(
      jest.mocked(repos.workOrder.addServiceItems).mock.invocationCallOrder[0],
    );

    expect(cache.delete).toHaveBeenCalledWith([workOrderCacheKey(workOrder.id)]);
    expect(logger.event).toHaveBeenCalledTimes(1);
    expect(logger.event).toHaveBeenCalledWith(BUSINESS_EVENTS.SAGA_COMPLETED, {
      sagaId: saga.id,
      sagaType: SagaType.QUOTE_APPROVAL,
      sagaStatus: SagaStatus.COMPLETED,
      quoteId: quote.id,
      workOrderId: workOrder.id,
      workOrderNumber: workOrder.number.toString(),
    });

    expect(metrics.increment).toHaveBeenCalledTimes(1);
    expect(metrics.increment).toHaveBeenCalledWith(BUSINESS_METRICS.SAGA_FINISHED, {
      sagaType: SagaType.QUOTE_APPROVAL,
      sagaOutcome: 'completed',
    });

    expect(metrics.record).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'work_order.status.duration' }),
      2 * 3600,
      { workOrderStatus: WorkOrderStatus.AWAITING_APPROVAL },
    );
  });

  it('should time the saga from the update timestamp the repository saved', async () => {
    const quote = readInternalQuoteFixture().data;

    sagaInstanceRepository.findByTypeAndCorrelationId.mockResolvedValue(
      createMockSagaInstance({ correlationId: quote.id, status: SagaStatus.RESERVING_STOCK }),
    );

    billingQuotesGateway.getQuote.mockResolvedValue(quote);

    jest
      .mocked(repos.workOrder.findByIdWithDetails)
      .mockResolvedValue(
        createMockWorkOrder({ id: quote.workOrderId, status: WorkOrderStatus.AWAITING_APPROVAL }),
      );

    jest.mocked(repos.sagaInstance.update).mockResolvedValue(
      createMockSagaInstance({
        correlationId: quote.id,
        status: SagaStatus.COMPLETED,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:10:00.000Z'),
      }),
    );

    await useCase.execute(quote.id);

    expect(metrics.record).toHaveBeenCalledWith(BUSINESS_METRICS.SAGA_DURATION, 600, {
      sagaType: SagaType.QUOTE_APPROVAL,
      sagaOutcome: 'completed',
    });
  });

  it.each([
    ['COMPLETED', SagaStatus.COMPLETED],
    ['COMPENSATING', SagaStatus.COMPENSATING],
    ['missing', undefined],
  ])(
    'should not read the Billing for a reservation reply when the saga is %s',
    async (_label, sagaStatus) => {
      const quoteId = readInternalQuoteFixture().data.id;

      sagaInstanceRepository.findByTypeAndCorrelationId.mockResolvedValue(
        sagaStatus ? createMockSagaInstance({ status: sagaStatus }) : null,
      );

      await useCase.execute(quoteId);

      expect(billingQuotesGateway.getQuote).not.toHaveBeenCalled();
      expect(unitOfWork.executeTransaction).not.toHaveBeenCalled();
      expect(cache.delete).not.toHaveBeenCalled();

      expect(logger.event).toHaveBeenCalledWith(BUSINESS_EVENTS.SAGA_STEP_SKIPPED, {
        sagaType: SagaType.QUOTE_APPROVAL,
        quoteId,
        sagaStatus,
      });
    },
  );

  it('should fail and change nothing when the Billing does not answer', async () => {
    const quoteId = readInternalQuoteFixture().data.id;

    sagaInstanceRepository.findByTypeAndCorrelationId.mockResolvedValue(
      createMockSagaInstance({ correlationId: quoteId, status: SagaStatus.RESERVING_STOCK }),
    );

    billingQuotesGateway.getQuote.mockRejectedValue(
      new ServiceIntegrationException('Serviço de destino indisponível'),
    );

    await expect(useCase.execute(quoteId)).rejects.toThrow(ServiceIntegrationException);

    expect(unitOfWork.executeTransaction).not.toHaveBeenCalled();
    expect(cache.delete).not.toHaveBeenCalled();
    expect(logger.event).not.toHaveBeenCalled();
  });

  it('should leave cache, log and metric untouched when the transaction fails', async () => {
    const quote = readInternalQuoteFixture().data;

    sagaInstanceRepository.findByTypeAndCorrelationId.mockResolvedValue(
      createMockSagaInstance({ correlationId: quote.id, status: SagaStatus.RESERVING_STOCK }),
    );

    billingQuotesGateway.getQuote.mockResolvedValue(quote);

    unitOfWork.executeTransaction.mockRejectedValueOnce(new Error('commit failed'));

    await expect(useCase.execute(quote.id)).rejects.toThrow('commit failed');

    expect(cache.delete).not.toHaveBeenCalled();
    expect(logger.event).not.toHaveBeenCalled();
    expect(metrics.increment).not.toHaveBeenCalled();
    expect(metrics.record).not.toHaveBeenCalled();
  });
});
