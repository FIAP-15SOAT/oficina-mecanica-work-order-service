import { randomUUID } from 'node:crypto';
import { ConfirmQuoteApprovalReversalUseCase } from '@application/use-cases/quote-approval/confirm-quote-approval-reversal.use-case';
import { WorkOrderStatus } from '@domain/enums/work-order-status.enum';
import { SagaType } from '@domain/enums/saga-type.enum';
import { SagaStatus } from '@domain/enums/saga-status.enum';
import { SagaFailureReason } from '@domain/enums/saga-failure-reason.enum';
import { createMockWorkOrder } from '../../../../helpers/work-order-mock.factory';
import { createMockCustomer } from '../../../../helpers/customer-mock.factory';
import { createMockSagaInstance } from '../../../../helpers/saga-instance-mock.factory';
import { createMockUnitOfWorkWithRepos } from '../../../../helpers/unit-of-work-mock.factory';
import { IUnitOfWork, IRepositories } from '@domain/interfaces/repositories/unit-of-work.interface';
import { ILogger } from '@application/ports/output/services/logger.service.interface';
import { createMockLogger } from '../../../../helpers/logger-mock.factory';
import { IEmailSenderService } from '@application/ports/output/services/email-sender.service.interface';
import { BUSINESS_EVENTS } from '@application/logging/business-event.catalog';
import { WorkOrder } from '@domain/entities/work-order.entity';
import { SagaInstance } from '@domain/entities/saga-instance.entity';

describe('ConfirmQuoteApprovalReversalUseCase', () => {
  let useCase: ConfirmQuoteApprovalReversalUseCase;
  let unitOfWork: jest.Mocked<IUnitOfWork>;
  let repos: jest.Mocked<IRepositories>;
  let logger: jest.Mocked<ILogger>;
  let emailSender: jest.Mocked<IEmailSenderService>;
  let quoteId: string;
  let workOrder: WorkOrder;
  let saga: SagaInstance;

  beforeEach(() => {
    ({ unitOfWork, repos } = createMockUnitOfWorkWithRepos());

    logger = createMockLogger();

    emailSender = { send: jest.fn().mockResolvedValue(undefined) };

    quoteId = randomUUID();

    workOrder = createMockWorkOrder({
      status: WorkOrderStatus.AWAITING_APPROVAL,
      customer: createMockCustomer({ name: 'Maria Souza' }),
    });

    saga = createMockSagaInstance({
      correlationId: quoteId,
      workOrderId: workOrder.id,
      status: SagaStatus.COMPENSATING,
      failureReason: SagaFailureReason.INSUFFICIENT_STOCK,
    });

    jest.mocked(repos.sagaInstance.findByTypeAndCorrelationId).mockResolvedValue(saga);

    jest.mocked(repos.workOrder.findByIdWithDetails).mockResolvedValue(workOrder);

    useCase = new ConfirmQuoteApprovalReversalUseCase(unitOfWork, logger, emailSender);
  });

  it('should compensate the saga and record the reversal for missing stock in the history', async () => {
    await useCase.execute(quoteId);

    expect(repos.sagaInstance.findByTypeAndCorrelationId).toHaveBeenCalledWith(
      SagaType.QUOTE_APPROVAL,
      quoteId,
    );

    expect(saga.status).toBe(SagaStatus.COMPENSATED);
    expect(repos.sagaInstance.update).toHaveBeenCalledWith(saga);

    expect(repos.statusHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        workOrderId: workOrder.id,
        changedById: null,
        previousStatus: WorkOrderStatus.AWAITING_APPROVAL,
        newStatus: WorkOrderStatus.AWAITING_APPROVAL,
        notes: `Aprovação do orçamento ${quoteId} desfeita por falta de estoque`,
      }),
    );

    expect(workOrder.status).toBe(WorkOrderStatus.AWAITING_APPROVAL);

    expect(logger.event).toHaveBeenCalledWith(BUSINESS_EVENTS.QUOTE_APPROVAL_COMPENSATED, {
      sagaId: saga.id,
      quoteId,
      workOrderId: workOrder.id,
      workOrderNumber: workOrder.number.toString(),
      sagaFailureReason: SagaFailureReason.INSUFFICIENT_STOCK,
    });
  });

  it('should e-mail the customer about the missing stock after the commit', async () => {
    await useCase.execute(quoteId);

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

    await useCase.execute(quoteId);

    expect(saga.status).toBe(SagaStatus.COMPENSATED);

    expect(logger.event).toHaveBeenCalledWith(
      BUSINESS_EVENTS.QUOTE_APPROVAL_COMPENSATED,
      expect.objectContaining({ quoteId }),
    );
  });

  it('should compensate a saga reverted because the work order was not awaiting approval without e-mailing anyone', async () => {
    const cancelledWorkOrder = createMockWorkOrder({ status: WorkOrderStatus.CANCELLED });

    const notAwaitingSaga = createMockSagaInstance({
      correlationId: quoteId,
      workOrderId: cancelledWorkOrder.id,
      status: SagaStatus.COMPENSATING,
      failureReason: SagaFailureReason.WORK_ORDER_NOT_AWAITING,
    });

    jest.mocked(repos.sagaInstance.findByTypeAndCorrelationId).mockResolvedValue(notAwaitingSaga);

    jest.mocked(repos.workOrder.findByIdWithDetails).mockResolvedValue(cancelledWorkOrder);

    await useCase.execute(quoteId);

    expect(notAwaitingSaga.status).toBe(SagaStatus.COMPENSATED);

    expect(repos.statusHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        previousStatus: WorkOrderStatus.CANCELLED,
        newStatus: WorkOrderStatus.CANCELLED,
        notes: `Aprovação do orçamento ${quoteId} desfeita: a Ordem de Serviço não aguardava aprovação`,
      }),
    );

    expect(emailSender.send).not.toHaveBeenCalled();

    expect(logger.event).toHaveBeenCalledWith(
      BUSINESS_EVENTS.QUOTE_APPROVAL_COMPENSATED,
      expect.objectContaining({ sagaFailureReason: SagaFailureReason.WORK_ORDER_NOT_AWAITING }),
    );
  });

  it.each([
    ['RESERVING_STOCK', SagaStatus.RESERVING_STOCK],
    ['COMPLETED', SagaStatus.COMPLETED],
    ['COMPENSATED', SagaStatus.COMPENSATED],
    ['missing', undefined],
  ])('should skip a reversal when the saga is %s', async (_label, sagaStatus) => {
    jest
      .mocked(repos.sagaInstance.findByTypeAndCorrelationId)
      .mockResolvedValue(sagaStatus ? createMockSagaInstance({ status: sagaStatus }) : null);

    await useCase.execute(quoteId);

    expect(repos.sagaInstance.update).not.toHaveBeenCalled();
    expect(repos.statusHistory.create).not.toHaveBeenCalled();
    expect(emailSender.send).not.toHaveBeenCalled();

    expect(logger.event).toHaveBeenCalledWith(BUSINESS_EVENTS.QUOTE_APPROVAL_STEP_SKIPPED, {
      quoteId,
      sagaStatus,
    });
  });
});
