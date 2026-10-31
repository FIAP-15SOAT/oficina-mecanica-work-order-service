import { randomUUID } from 'node:crypto';
import { ApproveQuoteUseCase } from '@application/use-cases/quote/approve-quote.use-case';
import { ResourceNotFoundException } from '@application/exceptions/resource-not-found.exception';
import { BusinessRuleViolationException } from '@domain/exceptions/business-rule-violation.exception';
import { QuoteStatus } from '@domain/enums/quote-status.enum';
import { WorkOrderStatus } from '@domain/enums/work-order-status.enum';
import { ConcurrencyException } from '@infrastructure/exceptions/concurrency.exception';
import {
  createMockQuote,
  createMockQuotePartSupply,
  createMockQuoteService,
} from '../../../../helpers/quote-mock.factory';
import { createMockWorkOrder } from '../../../../helpers/work-order-mock.factory';
import { createMockPartSupply } from '../../../../helpers/part-supply-mock.factory';
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

describe('ApproveQuoteUseCase', () => {
  let cache: jest.Mocked<ICache>;
  let useCase: ApproveQuoteUseCase;
  let logger: jest.Mocked<ILogger>;
  let mockRepos: jest.Mocked<IRepositories>;
  let mockUow: jest.Mocked<IUnitOfWork>;
  let metrics: jest.Mocked<IMetrics>;

  beforeEach(() => {
    const { unitOfWork, repos } = createMockUnitOfWorkWithRepos();
    mockRepos = repos;
    mockUow = unitOfWork;
    metrics = createMockMetrics();
    logger = createMockLogger();
    cache = createMockCache();
    useCase = new ApproveQuoteUseCase(mockUow, logger, metrics, mockRepos.statusHistory, cache);
  });

  it('should approve quote, create WO services, WO parts, stock reservations and update work order', async () => {
    const partSupplyId = randomUUID();
    const partSupply = createMockPartSupply({ id: partSupplyId, stock: 10, reservedStock: 2 });
    const qPart = createMockQuotePartSupply({ partSupplyId: partSupply.id, quantity: 2 });
    const qService = createMockQuoteService();
    const quote = createMockQuote({
      status: QuoteStatus.SENT,
      totalAmount: 500,
      services: [qService],
      partsSupplies: [qPart],
    });

    const workOrder = createMockWorkOrder({
      id: quote.workOrderId,
      status: WorkOrderStatus.AWAITING_APPROVAL,
    });

    (mockRepos.quote.findByIdWithDetails as jest.Mock).mockResolvedValue(quote);
    (mockRepos.workOrder.findByIdWithDetails as jest.Mock).mockResolvedValue(workOrder);
    (mockRepos.partSupply.findByIds as jest.Mock).mockResolvedValue([partSupply]);
    (mockRepos.stockReservation.createMany as jest.Mock).mockResolvedValue(undefined);
    (mockRepos.partSupply.update as jest.Mock).mockResolvedValue(undefined);
    (mockRepos.workOrder.addServiceItems as jest.Mock).mockResolvedValue(undefined);
    (mockRepos.workOrder.addPartSupplyItems as jest.Mock).mockResolvedValue(undefined);
    (mockRepos.quote.update as jest.Mock).mockResolvedValue(quote);
    (mockRepos.quote.rejectPendingByWorkOrderId as jest.Mock).mockResolvedValue(undefined);
    (mockRepos.workOrder.update as jest.Mock).mockResolvedValue(workOrder);
    (mockRepos.statusHistory.create as jest.Mock).mockResolvedValue({});

    const result = await useCase.execute(quote.id, '550e8400-e29b-41d4-a716-446655440099');

    expect(mockRepos.quote.update).toHaveBeenCalled();
    expect(mockRepos.workOrder.update).toHaveBeenCalled();
    expect(mockRepos.statusHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        changedById: '550e8400-e29b-41d4-a716-446655440099',
      }),
    );
    expect(mockRepos.stockReservation.createMany).toHaveBeenCalledTimes(1);
    expect(mockRepos.workOrder.addServiceItems).toHaveBeenCalledTimes(1);
    expect(mockRepos.workOrder.addPartSupplyItems).toHaveBeenCalledTimes(1);
    expect(result.status).toBe(QuoteStatus.APPROVED);
  });

  it('should handle null userId when not provided', async () => {
    const quote = createMockQuote({ status: QuoteStatus.SENT, services: [], partsSupplies: [] });

    const workOrder = createMockWorkOrder({
      id: quote.workOrderId,
      status: WorkOrderStatus.AWAITING_APPROVAL,
    });

    (mockRepos.quote.findByIdWithDetails as jest.Mock).mockResolvedValue(quote);
    (mockRepos.workOrder.findByIdWithDetails as jest.Mock).mockResolvedValue(workOrder);
    (mockRepos.quote.update as jest.Mock).mockResolvedValue(quote);
    (mockRepos.quote.rejectPendingByWorkOrderId as jest.Mock).mockResolvedValue(undefined);
    (mockRepos.workOrder.update as jest.Mock).mockResolvedValue(workOrder);
    (mockRepos.workOrder.addServiceItems as jest.Mock).mockResolvedValue(undefined);
    (mockRepos.workOrder.addPartSupplyItems as jest.Mock).mockResolvedValue(undefined);

    await useCase.execute(quote.id);

    expect(mockRepos.statusHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        changedById: null,
      }),
    );
  });

  it('should throw ResourceNotFoundException when quote not found', async () => {
    (mockRepos.quote.findByIdWithDetails as jest.Mock).mockResolvedValue(null);

    await expect(useCase.execute('nonexistent-id')).rejects.toThrow(ResourceNotFoundException);
  });

  it('should throw BusinessRuleViolationException when quote cannot be approved (not SENT)', async () => {
    const quote = createMockQuote({ status: QuoteStatus.PENDING });
    (mockRepos.quote.findByIdWithDetails as jest.Mock).mockResolvedValue(quote);

    await expect(useCase.execute(quote.id)).rejects.toThrow(BusinessRuleViolationException);
  });

  it('should propagate ConcurrencyException when workOrder is concurrently modified', async () => {
    const quote = createMockQuote({ status: QuoteStatus.SENT, services: [], partsSupplies: [] });

    const workOrder = createMockWorkOrder({
      id: quote.workOrderId,
      status: WorkOrderStatus.AWAITING_APPROVAL,
    });

    (mockRepos.quote.findByIdWithDetails as jest.Mock).mockResolvedValue(quote);
    (mockRepos.workOrder.findByIdWithDetails as jest.Mock).mockResolvedValue(workOrder);
    (mockRepos.quote.update as jest.Mock).mockResolvedValue(quote);
    (mockRepos.quote.rejectPendingByWorkOrderId as jest.Mock).mockResolvedValue(undefined);
    (mockRepos.workOrder.addServiceItems as jest.Mock).mockResolvedValue(undefined);
    (mockRepos.workOrder.addPartSupplyItems as jest.Mock).mockResolvedValue(undefined);
    (mockRepos.workOrder.update as jest.Mock).mockRejectedValue(
      new ConcurrencyException('Ordem de serviço foi modificada por outra operação.'),
    );

    await expect(useCase.execute(quote.id)).rejects.toThrow(ConcurrencyException);
  });

  it('should throw BusinessRuleViolationException when insufficient stock', async () => {
    const partSupply = createMockPartSupply({ stock: 1, reservedStock: 1 });
    const qPart = createMockQuotePartSupply({ partSupplyId: partSupply.id, quantity: 2 });
    const quote = createMockQuote({
      status: QuoteStatus.SENT,
      services: [],
      partsSupplies: [qPart],
    });

    const workOrder = createMockWorkOrder({
      id: quote.workOrderId,
      status: WorkOrderStatus.AWAITING_APPROVAL,
    });

    (mockRepos.quote.findByIdWithDetails as jest.Mock).mockResolvedValue(quote);
    (mockRepos.workOrder.findByIdWithDetails as jest.Mock).mockResolvedValue(workOrder);
    (mockRepos.partSupply.findByIds as jest.Mock).mockResolvedValue([partSupply]);

    await expect(useCase.execute(quote.id)).rejects.toThrow(BusinessRuleViolationException);
  });

  it('should emit no success event when the transaction rolls back', async () => {
    (mockRepos.quote.findByIdWithDetails as jest.Mock).mockRejectedValue(
      new Error('deadlock detected'),
    );

    await expect(useCase.execute(randomUUID())).rejects.toThrow('deadlock detected');

    expect(logger.event).not.toHaveBeenCalled();
  });

  it('should emit the business event only after the transaction resolves', async () => {
    const quote = createMockQuote({ status: QuoteStatus.SENT, services: [], partsSupplies: [] });
    const workOrder = createMockWorkOrder({
      id: quote.workOrderId,
      status: WorkOrderStatus.AWAITING_APPROVAL,
    });

    (mockRepos.quote.findByIdWithDetails as jest.Mock).mockResolvedValue(quote);
    (mockRepos.workOrder.findByIdWithDetails as jest.Mock).mockResolvedValue(workOrder);
    (mockRepos.quote.update as jest.Mock).mockResolvedValue(quote);
    (mockRepos.workOrder.update as jest.Mock).mockResolvedValue(workOrder);
    (mockRepos.statusHistory.create as jest.Mock).mockResolvedValue({});

    let emittedDuringTransaction = false;
    (mockRepos.quote.rejectPendingByWorkOrderId as jest.Mock).mockImplementation(() => {
      emittedDuringTransaction = logger.event.mock.calls.length > 0;

      return Promise.resolve();
    });

    await useCase.execute(quote.id, randomUUID());

    expect(emittedDuringTransaction).toBe(false);
    expect(logger.event).toHaveBeenCalledTimes(1);
    expect(logger.event.mock.calls[0][1]).toEqual({
      quoteId: quote.id,
      previousQuoteStatus: QuoteStatus.SENT,
      workOrderId: workOrder.id,
      workOrderNumber: workOrder.number.toString(),
      previousWorkOrderStatus: WorkOrderStatus.AWAITING_APPROVAL,
      customerId: workOrder.customerId,
    });
  });
  describe('dwell metrics', () => {
    it('should record the dwell in AWAITING_APPROVAL after the commit', async () => {
      const quote = createMockQuote({ status: QuoteStatus.SENT, services: [], partsSupplies: [] });
      const workOrder = createMockWorkOrder({
        id: quote.workOrderId,
        status: WorkOrderStatus.AWAITING_APPROVAL,
      });

      (mockRepos.quote.findByIdWithDetails as jest.Mock).mockResolvedValue(quote);
      (mockRepos.workOrder.findByIdWithDetails as jest.Mock).mockResolvedValue(workOrder);
      (mockRepos.quote.update as jest.Mock).mockResolvedValue(quote);
      (mockRepos.quote.rejectPendingByWorkOrderId as jest.Mock).mockResolvedValue(undefined);
      (mockRepos.workOrder.update as jest.Mock).mockResolvedValue(workOrder);
      (mockRepos.workOrder.addServiceItems as jest.Mock).mockResolvedValue(undefined);
      (mockRepos.workOrder.addPartSupplyItems as jest.Mock).mockResolvedValue(undefined);
      arrangeStatusHistory(
        mockRepos.statusHistory,
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

      await useCase.execute(quote.id);

      expect(metrics.record).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'work_order.status.duration' }),
        4 * 3600,
        { workOrderStatus: WorkOrderStatus.AWAITING_APPROVAL },
      );
    });

    it('should not record a metric when the transaction throws', async () => {
      (mockRepos.quote.findByIdWithDetails as jest.Mock).mockResolvedValue(null);

      await expect(useCase.execute(randomUUID())).rejects.toThrow();

      expect(metrics.record).not.toHaveBeenCalled();
    });
  });

  it('should delete the work order cache keys after the commit', async () => {
    const quote = createMockQuote({
      status: QuoteStatus.SENT,
      services: [createMockQuoteService()],
    });

    const workOrder = createMockWorkOrder({
      id: quote.workOrderId,
      status: WorkOrderStatus.AWAITING_APPROVAL,
    });

    (mockRepos.quote.findByIdWithDetails as jest.Mock).mockResolvedValue(quote);
    (mockRepos.workOrder.findByIdWithDetails as jest.Mock).mockResolvedValue(workOrder);
    (mockRepos.partSupply.findByIds as jest.Mock).mockResolvedValue([]);
    (mockRepos.quote.update as jest.Mock).mockResolvedValue(quote);
    (mockRepos.workOrder.update as jest.Mock).mockResolvedValue(workOrder);
    (mockRepos.statusHistory.create as jest.Mock).mockResolvedValue({});

    await useCase.execute(quote.id, '550e8400-e29b-41d4-a716-446655440099');

    expect(cache.delete).toHaveBeenCalledWith([workOrderCacheKey(workOrder.id)]);

    expect(cache.delete.mock.invocationCallOrder[0]).toBeGreaterThan(
      jest.mocked(mockRepos.workOrder.update).mock.invocationCallOrder[0],
    );
  });

  it('should not touch the cache when the write fails', async () => {
    mockUow.executeTransaction.mockRejectedValueOnce(new Error('commit failed'));

    await expect(useCase.execute(randomUUID())).rejects.toThrow('commit failed');

    expect(cache.delete).not.toHaveBeenCalled();
  });
});
