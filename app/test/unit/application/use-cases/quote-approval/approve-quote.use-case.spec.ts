import { randomUUID } from 'node:crypto';
import { ApproveQuoteUseCase } from '@application/use-cases/quote-approval/approve-quote.use-case';
import { ResourceNotFoundException } from '@application/exceptions/resource-not-found.exception';
import { BusinessRuleViolationException } from '@domain/exceptions/business-rule-violation.exception';
import { QuoteStatus } from '@domain/enums/quote-status.enum';
import { WorkOrderStatus } from '@domain/enums/work-order-status.enum';
import { SagaType } from '@domain/enums/saga-type.enum';
import { SagaStatus } from '@domain/enums/saga-status.enum';
import { SagaFailureReason } from '@domain/enums/saga-failure-reason.enum';
import {
  createMockQuote,
  createMockQuotePartSupply,
  createMockQuoteService,
} from '../../../../helpers/quote-mock.factory';
import { createMockWorkOrder } from '../../../../helpers/work-order-mock.factory';
import { createMockSagaInstance } from '../../../../helpers/saga-instance-mock.factory';
import { createMockUnitOfWorkWithRepos } from '../../../../helpers/unit-of-work-mock.factory';
import { IUnitOfWork, IRepositories } from '@domain/interfaces/repositories/unit-of-work.interface';
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
import { BUSINESS_EVENTS } from '@application/logging/business-event.catalog';

describe('ApproveQuoteUseCase', () => {
  let useCase: ApproveQuoteUseCase;
  let unitOfWork: jest.Mocked<IUnitOfWork>;
  let repos: jest.Mocked<IRepositories>;
  let logger: jest.Mocked<ILogger>;
  let metrics: jest.Mocked<IMetrics>;
  let cache: jest.Mocked<ICache>;

  beforeEach(() => {
    ({ unitOfWork, repos } = createMockUnitOfWorkWithRepos());

    logger = createMockLogger();

    metrics = createMockMetrics();

    cache = createMockCache();

    useCase = new ApproveQuoteUseCase(unitOfWork, logger, metrics, repos.statusHistory, cache);
  });

  it('should approve a quote with parts, reject its pending and sent siblings and write the reserve command', async () => {
    const decidedBy = randomUUID();

    const partItem = createMockQuotePartSupply({ quantity: 3 });

    const quote = createMockQuote({
      status: QuoteStatus.SENT,
      services: [createMockQuoteService()],
      partsSupplies: [partItem],
    });

    const workOrder = createMockWorkOrder({
      id: quote.workOrderId,
      status: WorkOrderStatus.AWAITING_APPROVAL,
    });

    const pendingSibling = createMockQuote({
      workOrderId: workOrder.id,
      status: QuoteStatus.PENDING,
    });

    const sentSibling = createMockQuote({ workOrderId: workOrder.id, status: QuoteStatus.SENT });

    const rejectedSibling = createMockQuote({
      workOrderId: workOrder.id,
      status: QuoteStatus.REJECTED,
    });

    jest.mocked(repos.quote.findByIdWithDetails).mockResolvedValue(quote);

    jest.mocked(repos.workOrder.findByIdWithDetails).mockResolvedValue(workOrder);

    jest
      .mocked(repos.quote.findByWorkOrderId)
      .mockResolvedValue([
        createMockQuote({ id: quote.id, workOrderId: workOrder.id, status: QuoteStatus.SENT }),
        pendingSibling,
        sentSibling,
        rejectedSibling,
      ]);

    const result = await useCase.execute(quote.id, decidedBy);

    expect(result.status).toBe(QuoteStatus.APPROVED);
    expect(result.decidedBy).toBe(decidedBy);
    expect(jest.mocked(repos.quote.update).mock.calls.map(([updated]) => updated)).toEqual([
      quote,
      pendingSibling,
      sentSibling,
    ]);

    expect([pendingSibling, sentSibling]).toEqual([
      expect.objectContaining({ status: QuoteStatus.REJECTED, replacedByQuoteId: quote.id }),
      expect.objectContaining({ status: QuoteStatus.REJECTED, replacedByQuoteId: quote.id }),
    ]);

    expect(rejectedSibling.replacedByQuoteId).toBeNull();
    expect(repos.sagaInstance.create).toHaveBeenCalledWith(
      expect.objectContaining({
        type: SagaType.QUOTE_APPROVAL,
        correlationId: quote.id,
        workOrderId: workOrder.id,
        status: SagaStatus.RESERVING_STOCK,
      }),
    );

    expect(repos.outbox.add).toHaveBeenCalledWith({
      type: 'inventory.stock.reserve',
      workOrderId: workOrder.id,
      payload: {
        quoteId: quote.id,
        items: [{ partSupplyId: partItem.partSupplyId, quantity: 3 }],
      },
    });

    expect(workOrder.status).toBe(WorkOrderStatus.AWAITING_APPROVAL);
    expect(repos.statusHistory.create).not.toHaveBeenCalled();
    expect(repos.workOrder.addServiceItems).not.toHaveBeenCalled();
    expect(repos.workOrder.addPartSupplyItems).not.toHaveBeenCalled();
    expect(metrics.record).not.toHaveBeenCalled();
  });

  it('should approve a quote without parts, approve the work order and complete the saga in the same transaction', async () => {
    const decidedBy = randomUUID();

    const serviceItem = createMockQuoteService({ quantity: 2, unitPrice: 150, totalPrice: 300 });

    const quote = createMockQuote({
      status: QuoteStatus.SENT,
      services: [serviceItem],
      servicesAmount: 300,
      totalAmount: 300,
    });

    const workOrder = createMockWorkOrder({
      id: quote.workOrderId,
      status: WorkOrderStatus.AWAITING_APPROVAL,
    });

    jest.mocked(repos.quote.findByIdWithDetails).mockResolvedValue(quote);

    jest.mocked(repos.workOrder.findByIdWithDetails).mockResolvedValue(workOrder);

    jest.mocked(repos.quote.findByWorkOrderId).mockResolvedValue([]);

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
      new Date('2026-01-01T04:00:00.000Z'),
    );

    await useCase.execute(quote.id, decidedBy);

    expect(workOrder.status).toBe(WorkOrderStatus.APPROVED);
    expect(workOrder.totalAmount).toBe(300);
    expect(repos.workOrder.addServiceItems).toHaveBeenCalledWith([
      expect.objectContaining({
        serviceId: serviceItem.serviceId,
        quantity: 2,
        unitPrice: 150,
      }),
    ]);

    expect(repos.statusHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        changedById: decidedBy,
        previousStatus: WorkOrderStatus.AWAITING_APPROVAL,
        newStatus: WorkOrderStatus.APPROVED,
      }),
    );

    expect(repos.sagaInstance.create).toHaveBeenCalledWith(
      expect.objectContaining({
        correlationId: quote.id,
        status: SagaStatus.COMPLETED,
      }),
    );

    expect(repos.outbox.add).not.toHaveBeenCalled();
    expect(metrics.record).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'work_order.status.duration' }),
      4 * 3600,
      { workOrderStatus: WorkOrderStatus.AWAITING_APPROVAL },
    );
  });

  it('should record no decision author when no user is given', async () => {
    const quote = createMockQuote({
      status: QuoteStatus.SENT,
      services: [createMockQuoteService()],
    });

    jest.mocked(repos.quote.findByIdWithDetails).mockResolvedValue(quote);

    jest
      .mocked(repos.workOrder.findByIdWithDetails)
      .mockResolvedValue(
        createMockWorkOrder({ id: quote.workOrderId, status: WorkOrderStatus.AWAITING_APPROVAL }),
      );

    jest.mocked(repos.quote.findByWorkOrderId).mockResolvedValue([]);

    await useCase.execute(quote.id);

    expect(quote.decidedBy).toBeNull();
    expect(repos.statusHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({ changedById: null }),
    );
  });

  it('should reopen the compensated saga and write the reserve command again', async () => {
    const quote = createMockQuote({
      status: QuoteStatus.SENT,
      services: [createMockQuoteService()],
      partsSupplies: [createMockQuotePartSupply()],
    });

    const saga = createMockSagaInstance({
      correlationId: quote.id,
      workOrderId: quote.workOrderId,
      status: SagaStatus.COMPENSATED,
      failureReason: SagaFailureReason.INSUFFICIENT_STOCK,
    });

    jest.mocked(repos.quote.findByIdWithDetails).mockResolvedValue(quote);

    jest
      .mocked(repos.workOrder.findByIdWithDetails)
      .mockResolvedValue(
        createMockWorkOrder({ id: quote.workOrderId, status: WorkOrderStatus.AWAITING_APPROVAL }),
      );

    jest.mocked(repos.quote.findByWorkOrderId).mockResolvedValue([]);

    jest.mocked(repos.sagaInstance.findByTypeAndCorrelationId).mockResolvedValue(saga);

    await useCase.execute(quote.id, randomUUID());

    expect(repos.sagaInstance.findByTypeAndCorrelationId).toHaveBeenCalledWith(
      SagaType.QUOTE_APPROVAL,
      quote.id,
    );

    expect(repos.sagaInstance.update).toHaveBeenCalledWith(saga);
    expect(saga.status).toBe(SagaStatus.RESERVING_STOCK);
    expect(saga.failureReason).toBeNull();
    expect(repos.sagaInstance.create).not.toHaveBeenCalled();
    expect(repos.outbox.add).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'inventory.stock.reserve' }),
    );
  });

  it('should update the work order before any quote write', async () => {
    const quote = createMockQuote({
      status: QuoteStatus.SENT,
      services: [createMockQuoteService()],
      partsSupplies: [createMockQuotePartSupply()],
    });

    jest.mocked(repos.quote.findByIdWithDetails).mockResolvedValue(quote);

    jest
      .mocked(repos.workOrder.findByIdWithDetails)
      .mockResolvedValue(
        createMockWorkOrder({ id: quote.workOrderId, status: WorkOrderStatus.AWAITING_APPROVAL }),
      );

    jest
      .mocked(repos.quote.findByWorkOrderId)
      .mockResolvedValue([
        createMockQuote({ workOrderId: quote.workOrderId, status: QuoteStatus.SENT }),
      ]);

    await useCase.execute(quote.id, randomUUID());

    const workOrderUpdateOrder = jest.mocked(repos.workOrder.update).mock.invocationCallOrder[0];

    expect(jest.mocked(repos.quote.update).mock.invocationCallOrder).toHaveLength(2);
    expect(
      jest
        .mocked(repos.quote.update)
        .mock.invocationCallOrder.every((order) => order > workOrderUpdateOrder),
    ).toBe(true);
  });

  it('should answer 409 when the work order is not awaiting approval', async () => {
    const quote = createMockQuote({
      status: QuoteStatus.SENT,
      services: [createMockQuoteService()],
    });

    jest.mocked(repos.quote.findByIdWithDetails).mockResolvedValue(quote);

    jest
      .mocked(repos.workOrder.findByIdWithDetails)
      .mockResolvedValue(
        createMockWorkOrder({ id: quote.workOrderId, status: WorkOrderStatus.APPROVED }),
      );

    await expect(useCase.execute(quote.id, randomUUID())).rejects.toThrow(
      new BusinessRuleViolationException(
        'Orçamento só pode ser decidido com a Ordem de Serviço aguardando aprovação. Status atual: "APPROVED"',
      ),
    );

    expect(quote.status).toBe(QuoteStatus.SENT);
    expect(repos.workOrder.update).not.toHaveBeenCalled();
    expect(repos.quote.update).not.toHaveBeenCalled();
  });

  it('should answer 409 when the quote is not SENT', async () => {
    const quote = createMockQuote({ status: QuoteStatus.PENDING });

    jest.mocked(repos.quote.findByIdWithDetails).mockResolvedValue(quote);

    jest
      .mocked(repos.workOrder.findByIdWithDetails)
      .mockResolvedValue(
        createMockWorkOrder({ id: quote.workOrderId, status: WorkOrderStatus.AWAITING_APPROVAL }),
      );

    await expect(useCase.execute(quote.id)).rejects.toThrow(BusinessRuleViolationException);

    expect(repos.workOrder.update).not.toHaveBeenCalled();
  });

  it('should answer 404 when the quote does not exist', async () => {
    jest.mocked(repos.quote.findByIdWithDetails).mockResolvedValue(null);

    await expect(useCase.execute(randomUUID())).rejects.toThrow(ResourceNotFoundException);
  });

  it('should clear the work order cache and emit the approval event after the commit', async () => {
    const quote = createMockQuote({
      status: QuoteStatus.SENT,
      services: [createMockQuoteService()],
      partsSupplies: [createMockQuotePartSupply()],
    });

    const workOrder = createMockWorkOrder({
      id: quote.workOrderId,
      status: WorkOrderStatus.AWAITING_APPROVAL,
    });

    jest.mocked(repos.quote.findByIdWithDetails).mockResolvedValue(quote);

    jest.mocked(repos.workOrder.findByIdWithDetails).mockResolvedValue(workOrder);

    jest.mocked(repos.quote.findByWorkOrderId).mockResolvedValue([]);

    await useCase.execute(quote.id, randomUUID());

    expect(cache.delete).toHaveBeenCalledWith([workOrderCacheKey(workOrder.id)]);
    expect(logger.event).toHaveBeenCalledWith(BUSINESS_EVENTS.QUOTE_APPROVED, {
      quoteId: quote.id,
      previousQuoteStatus: QuoteStatus.SENT,
      workOrderId: workOrder.id,
      workOrderNumber: workOrder.number.toString(),
      previousWorkOrderStatus: WorkOrderStatus.AWAITING_APPROVAL,
      customerId: workOrder.customerId,
    });

    expect(cache.delete.mock.invocationCallOrder[0]).toBeGreaterThan(
      jest.mocked(repos.outbox.add).mock.invocationCallOrder[0],
    );
  });

  it('should leave cache, log and metric untouched when the transaction fails', async () => {
    unitOfWork.executeTransaction.mockRejectedValueOnce(new Error('commit failed'));

    await expect(useCase.execute(randomUUID())).rejects.toThrow('commit failed');

    expect(cache.delete).not.toHaveBeenCalled();
    expect(logger.event).not.toHaveBeenCalled();
    expect(metrics.record).not.toHaveBeenCalled();
  });
});
