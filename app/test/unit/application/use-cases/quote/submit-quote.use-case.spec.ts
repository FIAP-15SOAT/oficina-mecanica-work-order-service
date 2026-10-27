import { randomUUID } from 'node:crypto';
import { SubmitQuoteUseCase } from '@application/use-cases/quote/submit-quote.use-case';
import { ResourceNotFoundException } from '@application/exceptions/resource-not-found.exception';
import { BusinessRuleViolationException } from '@domain/exceptions/business-rule-violation.exception';
import { QuoteStatus } from '@domain/enums/quote-status.enum';
import { WorkOrderStatus } from '@domain/enums/work-order-status.enum';
import { createMockQuote, createMockQuoteService } from '../../../../helpers/quote-mock.factory';
import { createMockWorkOrder } from '../../../../helpers/work-order-mock.factory';
import { createMockCustomer } from '../../../../helpers/customer-mock.factory';
import { createMockUser } from '../../../../helpers/user-mock.factory';
import { createMockUnitOfWorkWithRepos } from '../../../../helpers/unit-of-work-mock.factory';
import { IUnitOfWork, IRepositories } from '@domain/interfaces/repositories/unit-of-work.interface';
import { Email } from '@domain/value-objects/email.vo';
import { SendEmailInput } from '@application/ports/output/email-sender.service.interface';
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

const mockEmailSender = {
  send: jest.fn().mockResolvedValue(undefined),
};

describe('SubmitQuoteUseCase', () => {
  let cache: jest.Mocked<ICache>;
  let useCase: SubmitQuoteUseCase;
  let logger: jest.Mocked<ILogger>;
  let mockRepos: jest.Mocked<IRepositories>;
  let mockUow: jest.Mocked<IUnitOfWork>;
  let metrics: jest.Mocked<IMetrics>;

  beforeEach(() => {
    jest.clearAllMocks();
    const { unitOfWork, repos } = createMockUnitOfWorkWithRepos();
    mockRepos = repos;
    mockUow = unitOfWork;
    (mockRepos.userCustomer.findUsersByCustomerId as jest.Mock).mockResolvedValue([]);
    metrics = createMockMetrics();
    logger = createMockLogger();
    cache = createMockCache();
    useCase = new SubmitQuoteUseCase(
      mockUow,
      mockEmailSender,
      logger,
      metrics,
      mockRepos.statusHistory,
      cache,
    );
  });

  it('should submit quote and change WO to AWAITING_APPROVAL when IN_DIAGNOSIS', async () => {
    const service = createMockQuoteService();
    const quote = createMockQuote({ status: QuoteStatus.PENDING, services: [service] });
    const workOrder = createMockWorkOrder({
      id: quote.workOrderId,
      status: WorkOrderStatus.IN_DIAGNOSIS,
    });
    const customer = createMockCustomer({ id: workOrder.customerId });
    const savedQuote = createMockQuote({ id: quote.id, status: QuoteStatus.SENT });

    (mockRepos.quote.findByIdWithDetails as jest.Mock).mockResolvedValue(quote);
    (mockRepos.workOrder.findById as jest.Mock).mockResolvedValue(workOrder);
    (mockRepos.customer.findById as jest.Mock).mockResolvedValue(customer);
    (mockRepos.quote.update as jest.Mock).mockResolvedValue(savedQuote);
    (mockRepos.workOrder.update as jest.Mock).mockResolvedValue(workOrder);
    (mockRepos.statusHistory.create as jest.Mock).mockResolvedValue({});

    const result = await useCase.execute(quote.id);

    expect(mockRepos.quote.update).toHaveBeenCalled();
    expect(mockRepos.workOrder.update).toHaveBeenCalled();
    expect(mockRepos.statusHistory.create).toHaveBeenCalled();
    expect(result).toBe(savedQuote);
  });

  it('should submit quote and change work order status to AWAITING_APPROVAL when REJECTED', async () => {
    const service = createMockQuoteService();
    const quote = createMockQuote({ status: QuoteStatus.PENDING, services: [service] });
    const workOrder = createMockWorkOrder({
      id: quote.workOrderId,
      status: WorkOrderStatus.REJECTED,
    });
    const customer = createMockCustomer({ id: workOrder.customerId });
    const savedQuote = createMockQuote({ id: quote.id, status: QuoteStatus.SENT });

    (mockRepos.quote.findByIdWithDetails as jest.Mock).mockResolvedValue(quote);
    (mockRepos.workOrder.findById as jest.Mock).mockResolvedValue(workOrder);
    (mockRepos.customer.findById as jest.Mock).mockResolvedValue(customer);
    (mockRepos.quote.update as jest.Mock).mockResolvedValue(savedQuote);
    (mockRepos.workOrder.update as jest.Mock).mockResolvedValue(workOrder);
    (mockRepos.statusHistory.create as jest.Mock).mockResolvedValue({});

    const result = await useCase.execute(quote.id);

    expect(mockRepos.workOrder.update).toHaveBeenCalled();
    expect(mockRepos.statusHistory.create).toHaveBeenCalled();
    expect(result).toBe(savedQuote);
  });

  it('should reject submitting when work order is still RECEIVED (not diagnosed)', async () => {
    const service = createMockQuoteService();
    const quote = createMockQuote({ status: QuoteStatus.PENDING, services: [service] });
    const workOrder = createMockWorkOrder({
      id: quote.workOrderId,
      status: WorkOrderStatus.RECEIVED,
    });

    (mockRepos.quote.findByIdWithDetails as jest.Mock).mockResolvedValue(quote);
    (mockRepos.workOrder.findById as jest.Mock).mockResolvedValue(workOrder);

    await expect(useCase.execute(quote.id)).rejects.toThrow(BusinessRuleViolationException);

    expect(mockRepos.quote.update).not.toHaveBeenCalled();
    expect(mockRepos.workOrder.update).not.toHaveBeenCalled();
    expect(mockRepos.statusHistory.create).not.toHaveBeenCalled();
    expect(mockEmailSender.send).not.toHaveBeenCalled();
  });

  it('should submit a competing quote without transitioning the work order when already AWAITING_APPROVAL', async () => {
    const service = createMockQuoteService();
    const quote = createMockQuote({ status: QuoteStatus.PENDING, services: [service] });
    const workOrder = createMockWorkOrder({
      id: quote.workOrderId,
      status: WorkOrderStatus.AWAITING_APPROVAL,
    });
    const customer = createMockCustomer({ id: workOrder.customerId });
    const savedQuote = createMockQuote({ id: quote.id, status: QuoteStatus.SENT });

    (mockRepos.quote.findByIdWithDetails as jest.Mock).mockResolvedValue(quote);
    (mockRepos.workOrder.findById as jest.Mock).mockResolvedValue(workOrder);
    (mockRepos.customer.findById as jest.Mock).mockResolvedValue(customer);
    (mockRepos.quote.update as jest.Mock).mockResolvedValue(savedQuote);

    const result = await useCase.execute(quote.id);

    expect(mockRepos.quote.update).toHaveBeenCalled();
    expect(mockRepos.workOrder.update).not.toHaveBeenCalled();
    expect(mockRepos.statusHistory.create).not.toHaveBeenCalled();
    expect(mockEmailSender.send).toHaveBeenCalled();
    expect(result).toBe(savedQuote);
  });

  it('should throw ResourceNotFoundException when quote not found', async () => {
    (mockRepos.quote.findById as jest.Mock).mockResolvedValue(null);

    await expect(useCase.execute('nonexistent-id')).rejects.toThrow(ResourceNotFoundException);
  });

  it('should throw BusinessRuleViolationException when quote is not PENDING', async () => {
    const quote = createMockQuote({ status: QuoteStatus.SENT });
    const workOrder = createMockWorkOrder({
      id: quote.workOrderId,
      status: WorkOrderStatus.IN_DIAGNOSIS,
    });

    (mockRepos.quote.findByIdWithDetails as jest.Mock).mockResolvedValue(quote);
    (mockRepos.workOrder.findById as jest.Mock).mockResolvedValue(workOrder);

    await expect(useCase.execute(quote.id)).rejects.toThrow(BusinessRuleViolationException);
  });

  it('should throw BusinessRuleViolationException when quote has no services or parts', async () => {
    const quote = createMockQuote({ status: QuoteStatus.PENDING });
    const workOrder = createMockWorkOrder({
      id: quote.workOrderId,
      status: WorkOrderStatus.IN_DIAGNOSIS,
    });

    // services and partsSupplies not set → treated as empty
    (mockRepos.quote.findByIdWithDetails as jest.Mock).mockResolvedValue(quote);
    (mockRepos.workOrder.findById as jest.Mock).mockResolvedValue(workOrder);

    await expect(useCase.execute(quote.id)).rejects.toThrow(BusinessRuleViolationException);
  });

  it('should send email to the customer when no active linked users exist', async () => {
    const service = createMockQuoteService();
    const quote = createMockQuote({ status: QuoteStatus.PENDING, services: [service] });
    const workOrder = createMockWorkOrder({
      id: quote.workOrderId,
      status: WorkOrderStatus.IN_DIAGNOSIS,
    });
    const customer = createMockCustomer({
      email: Email.create('test@example.com'),
      name: 'Cliente Teste',
    });
    const savedQuote = createMockQuote({ id: quote.id, status: QuoteStatus.SENT });

    (mockRepos.quote.findByIdWithDetails as jest.Mock).mockResolvedValue(quote);
    (mockRepos.workOrder.findById as jest.Mock).mockResolvedValue(workOrder);
    (mockRepos.customer.findById as jest.Mock).mockResolvedValue(customer);
    (mockRepos.quote.update as jest.Mock).mockResolvedValue(savedQuote);

    await useCase.execute(quote.id);

    expect(mockEmailSender.send).toHaveBeenCalledTimes(1);
    const emailContent = mockEmailSender.send.mock.calls[0][0] as SendEmailInput;
    expect(emailContent.toEmail).toBe('test@example.com');
    expect(emailContent.toName).toBe('Cliente Teste');
    expect(emailContent.message.text).not.toContain('http');
    expect(emailContent.message.html).not.toContain('http');
    expect(emailContent.message.text).toContain('Entre em contato com a oficina');
    expect(emailContent.message.html).toContain('Entre em contato com a oficina');
    expect(emailContent.message.text).not.toContain('Acesse o sistema autenticando');
  });

  it('should notify every active linked user, excluding inactive ones', async () => {
    const service = createMockQuoteService();
    const quote = createMockQuote({ status: QuoteStatus.PENDING, services: [service] });
    const workOrder = createMockWorkOrder({
      id: quote.workOrderId,
      status: WorkOrderStatus.IN_DIAGNOSIS,
    });
    const customer = createMockCustomer({ email: Email.create('commercial@example.com') });
    const savedQuote = createMockQuote({ id: quote.id, status: QuoteStatus.SENT });

    const activeUserA = createMockUser({
      email: Email.create('userA@example.com'),
      name: 'User A',
      isActive: true,
    });
    const activeUserB = createMockUser({
      email: Email.create('userB@example.com'),
      name: 'User B',
      isActive: true,
    });
    const inactiveUser = createMockUser({
      email: Email.create('inactive@example.com'),
      name: 'Inactive User',
      isActive: false,
    });

    (mockRepos.quote.findByIdWithDetails as jest.Mock).mockResolvedValue(quote);
    (mockRepos.workOrder.findById as jest.Mock).mockResolvedValue(workOrder);
    (mockRepos.customer.findById as jest.Mock).mockResolvedValue(customer);
    (mockRepos.quote.update as jest.Mock).mockResolvedValue(savedQuote);
    (mockRepos.userCustomer.findUsersByCustomerId as jest.Mock).mockResolvedValue([
      activeUserA,
      activeUserB,
      inactiveUser,
    ]);

    await useCase.execute(quote.id);

    expect(mockEmailSender.send).toHaveBeenCalledTimes(2);
    const sentEmails = mockEmailSender.send.mock.calls.map(
      ([content]: [SendEmailInput]) => content.toEmail,
    );
    expect(sentEmails.sort()).toEqual(['usera@example.com', 'userb@example.com']);

    for (const [content] of mockEmailSender.send.mock.calls as [SendEmailInput][]) {
      expect(content.message.text).toContain('Acesse o sistema autenticando com seu CPF e senha');
      expect(content.message.html).toContain('Acesse o sistema autenticando com seu CPF e senha');
      expect(content.message.text).not.toContain('Entre em contato com a oficina');
    }
  });

  it('should fail if email sending fails', async () => {
    const service = createMockQuoteService();
    const quote = createMockQuote({ status: QuoteStatus.PENDING, services: [service] });
    const workOrder = createMockWorkOrder({
      id: quote.workOrderId,
      status: WorkOrderStatus.IN_DIAGNOSIS,
    });
    const customer = createMockCustomer({ email: Email.create('test@example.com') });
    const savedQuote = createMockQuote({ id: quote.id, status: QuoteStatus.SENT });

    (mockRepos.quote.findByIdWithDetails as jest.Mock).mockResolvedValue(quote);
    (mockRepos.workOrder.findById as jest.Mock).mockResolvedValue(workOrder);
    (mockRepos.customer.findById as jest.Mock).mockResolvedValue(customer);
    (mockRepos.quote.update as jest.Mock).mockResolvedValue(savedQuote);
    mockEmailSender.send.mockRejectedValue(new Error('SMTP error'));

    await expect(useCase.execute(quote.id)).rejects.toThrow('SMTP error');
  });
  describe('dwell metrics', () => {
    beforeEach(() => {
      // `clearAllMocks` clears calls, not implementations: an earlier test
      // leaves the e-mail sender rejecting.
      mockEmailSender.send.mockResolvedValue(undefined);
    });

    function arrangeHistory(workOrderId: string) {
      arrangeStatusHistory(
        mockRepos.statusHistory,
        [
          createMockStatusHistory({
            workOrderId,
            previousStatus: WorkOrderStatus.RECEIVED,
            newStatus: WorkOrderStatus.IN_DIAGNOSIS,
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
          }),
        ],
        new Date('2026-01-01T03:00:00.000Z'),
      );
    }

    it('should record the dwell in IN_DIAGNOSIS when the work order transitions', async () => {
      const quote = createMockQuote({
        status: QuoteStatus.PENDING,
        services: [createMockQuoteService()],
      });
      const workOrder = createMockWorkOrder({
        id: quote.workOrderId,
        status: WorkOrderStatus.IN_DIAGNOSIS,
      });

      (mockRepos.quote.findByIdWithDetails as jest.Mock).mockResolvedValue(quote);
      (mockRepos.workOrder.findById as jest.Mock).mockResolvedValue(workOrder);
      (mockRepos.customer.findById as jest.Mock).mockResolvedValue(
        createMockCustomer({ id: workOrder.customerId }),
      );
      (mockRepos.quote.update as jest.Mock).mockResolvedValue(quote);
      (mockRepos.workOrder.update as jest.Mock).mockResolvedValue(workOrder);
      arrangeHistory(workOrder.id);

      await useCase.execute(quote.id);

      expect(metrics.record).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'work_order.status.duration' }),
        3 * 3600,
        { workOrderStatus: WorkOrderStatus.IN_DIAGNOSIS },
      );
    });

    /**
     * The transition only happens from `IN_DIAGNOSIS` or `REJECTED`. With the
     * work order already in `AWAITING_APPROVAL` there is no new history entry —
     * and the composite result must say so, or the post-commit section would
     * invent a dwell time.
     */
    it('should not record a metric when the work order was already in AWAITING_APPROVAL', async () => {
      const quote = createMockQuote({
        status: QuoteStatus.PENDING,
        services: [createMockQuoteService()],
      });
      const workOrder = createMockWorkOrder({
        id: quote.workOrderId,
        status: WorkOrderStatus.AWAITING_APPROVAL,
      });

      (mockRepos.quote.findByIdWithDetails as jest.Mock).mockResolvedValue(quote);
      (mockRepos.workOrder.findById as jest.Mock).mockResolvedValue(workOrder);
      (mockRepos.customer.findById as jest.Mock).mockResolvedValue(
        createMockCustomer({ id: workOrder.customerId }),
      );
      (mockRepos.quote.update as jest.Mock).mockResolvedValue(quote);

      await useCase.execute(quote.id);

      expect(metrics.record).not.toHaveBeenCalled();
      expect(mockRepos.statusHistory.findByWorkOrderId).not.toHaveBeenCalled();
    });
  });

  it('should delete the work order cache keys after the commit', async () => {
    const quote = createMockQuote({
      status: QuoteStatus.PENDING,
      services: [createMockQuoteService()],
    });

    const workOrder = createMockWorkOrder({
      id: quote.workOrderId,
      status: WorkOrderStatus.IN_DIAGNOSIS,
    });

    (mockRepos.quote.findByIdWithDetails as jest.Mock).mockResolvedValue(quote);
    (mockRepos.workOrder.findById as jest.Mock).mockResolvedValue(workOrder);
    (mockRepos.customer.findById as jest.Mock).mockResolvedValue(
      createMockCustomer({ id: workOrder.customerId }),
    );
    (mockRepos.quote.update as jest.Mock).mockResolvedValue(quote);
    (mockRepos.workOrder.update as jest.Mock).mockResolvedValue(workOrder);
    (mockRepos.statusHistory.create as jest.Mock).mockResolvedValue({});

    await useCase.execute(quote.id);

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
