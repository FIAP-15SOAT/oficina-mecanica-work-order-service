import { RejectQuoteUseCase } from '@application/use-cases/quote/reject-quote.use-case';
import { ResourceNotFoundException } from '@application/exceptions/resource-not-found.exception';
import { BusinessRuleViolationException } from '@domain/exceptions/business-rule-violation.exception';
import { QuoteStatus } from '@domain/enums/quote-status.enum';
import { WorkOrderStatus } from '@domain/enums/work-order-status.enum';
import { createMockQuote } from '../../../../helpers/quote-mock.factory';
import { createMockWorkOrder } from '../../../../helpers/work-order-mock.factory';
import { createMockUnitOfWorkWithRepos } from '../../../../helpers/unit-of-work-mock.factory';
import { IUnitOfWork, IRepositories } from '@domain/interfaces/repositories/unit-of-work.interface';
import { ILogger } from '@application/ports/output/logger.service.interface';
import { createMockLogger } from '../../../../helpers/logger-mock.factory';
import { IMetrics } from '@application/ports/output/metrics.service.interface';
import { createMockMetrics } from '../../../../helpers/metrics-mock.factory';
import {
  arrangeStatusHistory,
  createMockStatusHistory,
} from '../../../../helpers/status-history-mock.factory';
import { ICache } from '@application/ports/output/cache.service.interface';
import { workOrderCacheKey } from '@application/keys/work-order-cache-key';
import { createMockCache } from '../../../../helpers/cache-mock.factory';
import { randomUUID } from 'node:crypto';

describe('RejectQuoteUseCase', () => {
  let cache: jest.Mocked<ICache>;
  let useCase: RejectQuoteUseCase;
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
    useCase = new RejectQuoteUseCase(mockUow, logger, metrics, mockRepos.statusHistory, cache);
  });

  it('should reject quote and update work order status to REJECTED', async () => {
    const quote = createMockQuote({ status: QuoteStatus.SENT });
    const workOrder = createMockWorkOrder({
      id: quote.workOrderId,
      status: WorkOrderStatus.AWAITING_APPROVAL,
    });

    (mockRepos.quote.findById as jest.Mock).mockResolvedValue(quote);
    (mockRepos.workOrder.findById as jest.Mock).mockResolvedValue(workOrder);
    (mockRepos.quote.findByWorkOrderId as jest.Mock).mockResolvedValue([quote]);
    (mockRepos.workOrder.update as jest.Mock).mockResolvedValue(workOrder);
    (mockRepos.quote.update as jest.Mock).mockResolvedValue(quote);
    (mockRepos.statusHistory.create as jest.Mock).mockResolvedValue({});

    const result = await useCase.execute(
      quote.id,
      'Preço alto',
      '550e8400-e29b-41d4-a716-446655440099',
    );

    expect(mockRepos.quote.update).toHaveBeenCalled();
    expect(mockRepos.workOrder.update).toHaveBeenCalled();
    expect(mockRepos.statusHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        notes: 'Preço alto',
        changedById: '550e8400-e29b-41d4-a716-446655440099',
      }),
    );
    expect(result.status).toBe(QuoteStatus.REJECTED);
    expect(logger.event).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ customerId: workOrder.customerId }),
    );
  });

  it('should use default notes and null userId when not provided', async () => {
    const quote = createMockQuote({ status: QuoteStatus.SENT });
    const workOrder = createMockWorkOrder({
      id: quote.workOrderId,
      status: WorkOrderStatus.AWAITING_APPROVAL,
    });

    (mockRepos.quote.findById as jest.Mock).mockResolvedValue(quote);
    (mockRepos.workOrder.findById as jest.Mock).mockResolvedValue(workOrder);
    (mockRepos.quote.findByWorkOrderId as jest.Mock).mockResolvedValue([quote]);
    (mockRepos.quote.update as jest.Mock).mockResolvedValue(quote);
    (mockRepos.workOrder.update as jest.Mock).mockResolvedValue(workOrder);

    await useCase.execute(quote.id);

    expect(mockRepos.statusHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        notes: `Orçamento ${quote.id} rejeitado`,
        changedById: null,
      }),
    );
  });

  it('should throw ResourceNotFoundException when quote not found', async () => {
    (mockRepos.quote.findById as jest.Mock).mockResolvedValue(null);

    await expect(useCase.execute('nonexistent-id')).rejects.toThrow(ResourceNotFoundException);
  });

  it('should throw BusinessRuleViolationException when quote is not SENT', async () => {
    const quote = createMockQuote({ status: QuoteStatus.PENDING });
    (mockRepos.quote.findById as jest.Mock).mockResolvedValue(quote);

    await expect(useCase.execute(quote.id)).rejects.toThrow(BusinessRuleViolationException);
  });

  it('should keep the work order in AWAITING_APPROVAL when another quote is still SENT', async () => {
    const quote = createMockQuote({ status: QuoteStatus.SENT });
    const otherSentQuote = createMockQuote({ status: QuoteStatus.SENT });
    const workOrder = createMockWorkOrder({
      id: quote.workOrderId,
      status: WorkOrderStatus.AWAITING_APPROVAL,
    });

    (mockRepos.quote.findById as jest.Mock).mockResolvedValue(quote);
    (mockRepos.workOrder.findById as jest.Mock).mockResolvedValue(workOrder);
    (mockRepos.quote.findByWorkOrderId as jest.Mock).mockResolvedValue([quote, otherSentQuote]);
    (mockRepos.quote.update as jest.Mock).mockResolvedValue(quote);

    const result = await useCase.execute(quote.id);

    expect(mockRepos.quote.update).toHaveBeenCalled();
    expect(mockRepos.workOrder.update).not.toHaveBeenCalled();
    expect(mockRepos.statusHistory.create).not.toHaveBeenCalled();
    expect(result.status).toBe(QuoteStatus.REJECTED);
    expect(logger.event).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ customerId: workOrder.customerId }),
    );
  });
  describe('dwell metrics', () => {
    it('should record the dwell in AWAITING_APPROVAL when the work order transitions', async () => {
      const quote = createMockQuote({ status: QuoteStatus.SENT });
      const workOrder = createMockWorkOrder({
        id: quote.workOrderId,
        status: WorkOrderStatus.AWAITING_APPROVAL,
      });

      (mockRepos.quote.findById as jest.Mock).mockResolvedValue(quote);
      (mockRepos.workOrder.findById as jest.Mock).mockResolvedValue(workOrder);
      (mockRepos.quote.findByWorkOrderId as jest.Mock).mockResolvedValue([quote]);
      (mockRepos.quote.update as jest.Mock).mockResolvedValue(quote);
      (mockRepos.workOrder.update as jest.Mock).mockResolvedValue(workOrder);
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
        new Date('2026-01-01T01:30:00.000Z'),
      );

      await useCase.execute(quote.id);

      expect(metrics.record).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'work_order.status.duration' }),
        1.5 * 3600,
        { workOrderStatus: WorkOrderStatus.AWAITING_APPROVAL },
      );
    });

    /**
     * Without a work order transition there is no new history entry: there is
     * no dwell time to close, and emitting here would invent one.
     */
    it('should not record a metric when another submitted quote keeps the work order still', async () => {
      const quote = createMockQuote({ status: QuoteStatus.SENT });
      const sibling = createMockQuote({
        status: QuoteStatus.SENT,
        workOrderId: quote.workOrderId,
      });
      const workOrder = createMockWorkOrder({
        id: quote.workOrderId,
        status: WorkOrderStatus.AWAITING_APPROVAL,
      });

      (mockRepos.quote.findById as jest.Mock).mockResolvedValue(quote);
      (mockRepos.workOrder.findById as jest.Mock).mockResolvedValue(workOrder);
      (mockRepos.quote.findByWorkOrderId as jest.Mock).mockResolvedValue([quote, sibling]);
      (mockRepos.quote.update as jest.Mock).mockResolvedValue(quote);

      await useCase.execute(quote.id);

      expect(metrics.record).not.toHaveBeenCalled();
      expect(mockRepos.statusHistory.findByWorkOrderId).not.toHaveBeenCalled();
    });
  });

  it('should delete the work order cache keys after the commit', async () => {
    const quote = createMockQuote({ status: QuoteStatus.SENT });

    const workOrder = createMockWorkOrder({
      id: quote.workOrderId,
      status: WorkOrderStatus.AWAITING_APPROVAL,
    });

    (mockRepos.quote.findById as jest.Mock).mockResolvedValue(quote);
    (mockRepos.workOrder.findById as jest.Mock).mockResolvedValue(workOrder);
    (mockRepos.quote.findByWorkOrderId as jest.Mock).mockResolvedValue([quote]);
    (mockRepos.workOrder.update as jest.Mock).mockResolvedValue(workOrder);
    (mockRepos.quote.update as jest.Mock).mockResolvedValue(quote);
    (mockRepos.statusHistory.create as jest.Mock).mockResolvedValue({});

    await useCase.execute(quote.id, 'Preço alto', '550e8400-e29b-41d4-a716-446655440099');

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
