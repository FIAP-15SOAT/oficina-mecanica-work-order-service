import { randomUUID } from 'node:crypto';
import { CompensateQuoteApprovalUseCase } from '@application/use-cases/quote-approval/compensate-quote-approval.use-case';
import { QuoteStatus } from '@domain/enums/quote-status.enum';
import { WorkOrderStatus } from '@domain/enums/work-order-status.enum';
import { SagaType } from '@domain/enums/saga-type.enum';
import { SagaStatus } from '@domain/enums/saga-status.enum';
import { SagaFailureReason } from '@domain/enums/saga-failure-reason.enum';
import { createMockQuote } from '../../../../helpers/quote-mock.factory';
import { createMockWorkOrder } from '../../../../helpers/work-order-mock.factory';
import { createMockCustomer } from '../../../../helpers/customer-mock.factory';
import { createMockSagaInstance } from '../../../../helpers/saga-instance-mock.factory';
import { createMockUnitOfWorkWithRepos } from '../../../../helpers/unit-of-work-mock.factory';
import { IUnitOfWork, IRepositories } from '@domain/interfaces/repositories/unit-of-work.interface';
import { ILogger } from '@application/ports/output/services/logger.service.interface';
import { createMockLogger } from '../../../../helpers/logger-mock.factory';
import { IEmailSenderService } from '@application/ports/output/services/email-sender.service.interface';
import { BUSINESS_EVENTS } from '@application/logging/business-event.catalog';
import { Quote } from '@domain/entities/quote.entity';
import { WorkOrder } from '@domain/entities/work-order.entity';
import { SagaInstance } from '@domain/entities/saga-instance.entity';

describe('CompensateQuoteApprovalUseCase', () => {
  let useCase: CompensateQuoteApprovalUseCase;
  let unitOfWork: jest.Mocked<IUnitOfWork>;
  let repos: jest.Mocked<IRepositories>;
  let logger: jest.Mocked<ILogger>;
  let emailSender: jest.Mocked<IEmailSenderService>;
  let quote: Quote;
  let workOrder: WorkOrder;
  let saga: SagaInstance;

  beforeEach(() => {
    ({ unitOfWork, repos } = createMockUnitOfWorkWithRepos());

    logger = createMockLogger();

    emailSender = { send: jest.fn().mockResolvedValue(undefined) };

    quote = createMockQuote({
      status: QuoteStatus.APPROVED,
      sentAt: new Date(),
      approvedAt: new Date(),
      decidedBy: randomUUID(),
    });

    workOrder = createMockWorkOrder({
      id: quote.workOrderId,
      status: WorkOrderStatus.AWAITING_APPROVAL,
      customer: createMockCustomer({ name: 'Maria Souza' }),
    });

    saga = createMockSagaInstance({
      correlationId: quote.id,
      workOrderId: workOrder.id,
      status: SagaStatus.RESERVING_STOCK,
    });

    jest.mocked(repos.sagaInstance.findByTypeAndCorrelationId).mockResolvedValue(saga);

    jest.mocked(repos.quote.findById).mockResolvedValue(quote);

    jest.mocked(repos.quote.findByWorkOrderId).mockResolvedValue([quote]);

    jest.mocked(repos.workOrder.findByIdWithDetails).mockResolvedValue(workOrder);

    useCase = new CompensateQuoteApprovalUseCase(unitOfWork, logger, emailSender);
  });

  it('should return the quote to SENT, restore the siblings it replaced and compensate the saga', async () => {
    const sentSibling = createMockQuote({
      workOrderId: workOrder.id,
      status: QuoteStatus.REJECTED,
      sentAt: new Date(),
      rejectedAt: new Date(),
      replacedByQuoteId: quote.id,
    });

    const pendingSibling = createMockQuote({
      workOrderId: workOrder.id,
      status: QuoteStatus.REJECTED,
      rejectedAt: new Date(),
      replacedByQuoteId: quote.id,
    });

    const rejectedByCustomer = createMockQuote({
      workOrderId: workOrder.id,
      status: QuoteStatus.REJECTED,
      sentAt: new Date(),
      rejectedAt: new Date(),
    });

    jest
      .mocked(repos.quote.findByWorkOrderId)
      .mockResolvedValue([quote, sentSibling, pendingSibling, rejectedByCustomer]);

    await useCase.execute({ quoteId: quote.id, missingItemCount: 2 });

    expect(repos.sagaInstance.findByTypeAndCorrelationId).toHaveBeenCalledWith(
      SagaType.QUOTE_APPROVAL,
      quote.id,
    );

    expect(quote).toEqual(
      expect.objectContaining({ status: QuoteStatus.SENT, approvedAt: null, decidedBy: null }),
    );

    expect([sentSibling.status, pendingSibling.status]).toEqual([
      QuoteStatus.SENT,
      QuoteStatus.PENDING,
    ]);

    expect(rejectedByCustomer.status).toBe(QuoteStatus.REJECTED);
    expect(jest.mocked(repos.quote.update).mock.calls.map(([updated]) => updated)).toEqual([
      quote,
      sentSibling,
      pendingSibling,
    ]);

    expect(saga.status).toBe(SagaStatus.COMPENSATED);
    expect(saga.failureReason).toBe(SagaFailureReason.INSUFFICIENT_STOCK);
    expect(repos.sagaInstance.update).toHaveBeenCalledWith(saga);
    expect(logger.event).toHaveBeenCalledWith(BUSINESS_EVENTS.QUOTE_APPROVAL_COMPENSATED, {
      sagaId: saga.id,
      quoteId: quote.id,
      workOrderId: workOrder.id,
      workOrderNumber: workOrder.number.toString(),
      missingItemCount: 2,
    });
  });

  it('should record the compensation in the history without changing the work order status', async () => {
    await useCase.execute({ quoteId: quote.id, missingItemCount: 1 });

    expect(repos.statusHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        workOrderId: workOrder.id,
        changedById: null,
        previousStatus: WorkOrderStatus.AWAITING_APPROVAL,
        newStatus: WorkOrderStatus.AWAITING_APPROVAL,
        notes: `Aprovação do orçamento ${quote.id} desfeita por falta de estoque`,
      }),
    );

    expect(workOrder.status).toBe(WorkOrderStatus.AWAITING_APPROVAL);
    expect(repos.workOrder.update).not.toHaveBeenCalled();
  });

  it('should e-mail the customer about the missing stock after the commit', async () => {
    await useCase.execute({ quoteId: quote.id, missingItemCount: 1 });

    expect(emailSender.send).toHaveBeenCalledWith({
      toEmail: workOrder.customer!.email.value,
      toName: 'Maria Souza',
      subject: `Orçamento da Ordem de Serviço ${workOrder.number.toString()} - Estoque insuficiente`,
      message: {
        text: expect.stringContaining('voltou a aguardar sua aprovação'),
        html: expect.stringContaining('voltou a aguardar sua aprovação'),
      },
    });

    expect(emailSender.send.mock.invocationCallOrder[0]).toBeGreaterThan(
      unitOfWork.executeTransaction.mock.invocationCallOrder[0],
    );
  });

  it('should keep the compensation when the e-mail fails', async () => {
    emailSender.send.mockRejectedValueOnce(new Error('smtp down'));

    await useCase.execute({ quoteId: quote.id, missingItemCount: 1 });

    expect(saga.status).toBe(SagaStatus.COMPENSATED);
    expect(logger.event).toHaveBeenCalledWith(
      BUSINESS_EVENTS.QUOTE_APPROVAL_COMPENSATED,
      expect.objectContaining({ quoteId: quote.id }),
    );
  });

  it.each([
    ['COMPLETED', SagaStatus.COMPLETED],
    ['COMPENSATED', SagaStatus.COMPENSATED],
    ['missing', undefined],
  ])('should skip a reservation failure when the saga is %s', async (_label, sagaStatus) => {
    jest
      .mocked(repos.sagaInstance.findByTypeAndCorrelationId)
      .mockResolvedValue(sagaStatus ? createMockSagaInstance({ status: sagaStatus }) : null);

    await useCase.execute({ quoteId: quote.id, missingItemCount: 1 });

    expect(repos.quote.update).not.toHaveBeenCalled();
    expect(repos.sagaInstance.update).not.toHaveBeenCalled();
    expect(repos.statusHistory.create).not.toHaveBeenCalled();
    expect(emailSender.send).not.toHaveBeenCalled();
    expect(logger.event).toHaveBeenCalledWith(BUSINESS_EVENTS.QUOTE_APPROVAL_STEP_SKIPPED, {
      quoteId: quote.id,
      sagaStatus,
    });
  });
});
