import { randomUUID } from 'node:crypto';

import { WorkOrder } from '@domain/entities/work-order.entity';
import { WorkOrderStatus } from '@domain/enums/work-order-status.enum';
import { IRepositories, IUnitOfWork } from '@domain/interfaces/repositories/unit-of-work.interface';
import { IWorkOrderRepository } from '@domain/interfaces/repositories/work-order.repository.interface';

import { workOrderCacheKey } from '@application/keys/work-order-cache-key';
import { BUSINESS_EVENTS } from '@application/logging/business-event.catalog';
import { WorkOrderEmailComposer } from '@application/notifications/work-order-email.composer';
import { ApplySentQuoteInputDto } from '@application/ports/input/work-order/dto/apply-sent-quote.dto';
import { ICache } from '@application/ports/output/services/cache.service.interface';
import { ILogger } from '@application/ports/output/services/logger.service.interface';
import { IMetrics } from '@application/ports/output/services/metrics.service.interface';
import {
  CustomerEmailRecipient,
  CustomerEmailRecipientsResolver,
} from '@application/services/customer-email-recipients';
import { ApplySentQuoteUseCase } from '@application/use-cases/work-order/apply-sent-quote.use-case';

import { createMockCache } from '../../../../helpers/cache-mock.factory';
import { createMockCustomerEmailRecipientsResolver } from '../../../../helpers/customer-email-recipients-resolver-mock.factory';
import { createMockLogger } from '../../../../helpers/logger-mock.factory';
import { createMockMetrics } from '../../../../helpers/metrics-mock.factory';
import {
  arrangeStatusHistory,
  createMockStatusHistory,
} from '../../../../helpers/status-history-mock.factory';
import { createMockUnitOfWorkWithRepos } from '../../../../helpers/unit-of-work-mock.factory';
import {
  createMockWorkOrder,
  createMockWorkOrderRepository,
} from '../../../../helpers/work-order-mock.factory';

describe('ApplySentQuoteUseCase', () => {
  let useCase: ApplySentQuoteUseCase;
  let unitOfWork: jest.Mocked<IUnitOfWork>;
  let repos: jest.Mocked<IRepositories>;
  let workOrderRepository: jest.Mocked<IWorkOrderRepository>;
  let customerEmailRecipientsResolver: jest.Mocked<CustomerEmailRecipientsResolver>;
  let logger: jest.Mocked<ILogger>;
  let metrics: jest.Mocked<IMetrics>;
  let cache: jest.Mocked<ICache>;
  let recipients: CustomerEmailRecipient[];
  let workOrder: WorkOrder;
  let input: ApplySentQuoteInputDto;

  beforeEach(() => {
    ({ unitOfWork, repos } = createMockUnitOfWorkWithRepos());

    workOrderRepository = createMockWorkOrderRepository();

    customerEmailRecipientsResolver = createMockCustomerEmailRecipientsResolver();

    logger = createMockLogger();

    metrics = createMockMetrics();

    cache = createMockCache();

    recipients = [
      { email: 'joao@example.com', name: 'João Lima', hasAccess: true },
      { email: 'ana@example.com', name: 'Ana Reis', hasAccess: true },
    ];

    workOrder = createMockWorkOrder({ status: WorkOrderStatus.IN_DIAGNOSIS });

    input = {
      quoteId: randomUUID(),
      workOrderId: workOrder.id,
      sentBy: randomUUID(),
      total: '350.00',
      items: [
        { name: 'Troca de óleo', quantity: 1, unitPrice: '200.00' },
        { name: 'Filtro de óleo', quantity: 3, unitPrice: '50.00' },
      ],
    };

    customerEmailRecipientsResolver.resolveForCustomer.mockResolvedValue(recipients);

    workOrderRepository.findById.mockResolvedValue(workOrder);

    useCase = new ApplySentQuoteUseCase(
      unitOfWork,
      workOrderRepository,
      customerEmailRecipientsResolver,
      logger,
      metrics,
      repos.statusHistory,
      cache,
    );
  });

  it.each([WorkOrderStatus.IN_DIAGNOSIS, WorkOrderStatus.REJECTED])(
    'should move a work order in %s to AWAITING_APPROVAL with the sender in the history',
    async (status) => {
      const sentWorkOrder = createMockWorkOrder({ status });

      workOrderRepository.findById.mockResolvedValue(sentWorkOrder);

      await useCase.execute({ ...input, workOrderId: sentWorkOrder.id });

      expect(workOrderRepository.findById).toHaveBeenCalledWith(sentWorkOrder.id);
      expect(sentWorkOrder.status).toBe(WorkOrderStatus.AWAITING_APPROVAL);
      expect(repos.workOrder.update).toHaveBeenCalledWith(sentWorkOrder);

      expect(repos.statusHistory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          workOrderId: sentWorkOrder.id,
          changedById: input.sentBy,
          previousStatus: status,
          newStatus: WorkOrderStatus.AWAITING_APPROVAL,
        }),
      );
    },
  );

  it('should add one quote e-mail per recipient in the transaction of the transition', async () => {
    await useCase.execute(input);

    expect(customerEmailRecipientsResolver.resolveForCustomer).toHaveBeenCalledWith(
      workOrder.customerId,
    );

    expect(
      customerEmailRecipientsResolver.resolveForCustomer.mock.invocationCallOrder[0],
    ).toBeLessThan(unitOfWork.executeTransaction.mock.invocationCallOrder[0]);

    expect(repos.outbox.add).toHaveBeenCalledTimes(2);

    expect(repos.outbox.add).toHaveBeenNthCalledWith(
      1,
      WorkOrderEmailComposer.quoteSent({
        recipient: recipients[0],
        workOrderId: workOrder.id,
        workOrderNumber: workOrder.number.toString(),
        total: input.total,
        items: input.items,
      }),
    );

    expect(repos.outbox.add).toHaveBeenNthCalledWith(
      2,
      WorkOrderEmailComposer.quoteSent({
        recipient: recipients[1],
        workOrderId: workOrder.id,
        workOrderNumber: workOrder.number.toString(),
        total: input.total,
        items: input.items,
      }),
    );

    expect(jest.mocked(repos.workOrder.update).mock.invocationCallOrder[0]).toBeLessThan(
      jest.mocked(repos.outbox.add).mock.invocationCallOrder[0],
    );
  });

  it('should keep a work order already awaiting approval and still add the quote e-mail', async () => {
    const awaitingWorkOrder = createMockWorkOrder({ status: WorkOrderStatus.AWAITING_APPROVAL });

    workOrderRepository.findById.mockResolvedValue(awaitingWorkOrder);

    await useCase.execute({ ...input, workOrderId: awaitingWorkOrder.id });

    expect(awaitingWorkOrder.status).toBe(WorkOrderStatus.AWAITING_APPROVAL);
    expect(repos.workOrder.update).toHaveBeenCalledWith(awaitingWorkOrder);
    expect(repos.statusHistory.create).not.toHaveBeenCalled();
    expect(cache.delete).not.toHaveBeenCalled();
    expect(repos.outbox.add).toHaveBeenCalledTimes(2);

    expect(jest.mocked(repos.workOrder.update).mock.invocationCallOrder[0]).toBeLessThan(
      jest.mocked(repos.outbox.add).mock.invocationCallOrder[0],
    );
  });

  it.each([WorkOrderStatus.CANCELLED, WorkOrderStatus.RECEIVED])(
    'should skip a work order in %s without adding an e-mail',
    async (status) => {
      const outsideWorkOrder = createMockWorkOrder({ status });

      workOrderRepository.findById.mockResolvedValue(outsideWorkOrder);

      await useCase.execute({ ...input, workOrderId: outsideWorkOrder.id });

      expect(outsideWorkOrder.status).toBe(status);
      expect(customerEmailRecipientsResolver.resolveForCustomer).not.toHaveBeenCalled();
      expect(unitOfWork.executeTransaction).not.toHaveBeenCalled();
      expect(cache.delete).not.toHaveBeenCalled();

      expect(logger.event).toHaveBeenCalledWith(BUSINESS_EVENTS.QUOTE_EVENT_SKIPPED, {
        quoteId: input.quoteId,
        workOrderId: outsideWorkOrder.id,
        currentWorkOrderStatus: status,
      });
    },
  );

  it('should open no transaction when the recipients cannot be read', async () => {
    customerEmailRecipientsResolver.resolveForCustomer.mockRejectedValue(
      new Error('identity down'),
    );

    await expect(useCase.execute(input)).rejects.toThrow('identity down');

    expect(unitOfWork.executeTransaction).not.toHaveBeenCalled();
    expect(workOrder.status).toBe(WorkOrderStatus.IN_DIAGNOSIS);
    expect(cache.delete).not.toHaveBeenCalled();
  });

  it('should delete the work order cache and record the transition after the commit', async () => {
    arrangeStatusHistory(
      repos.statusHistory,
      [
        createMockStatusHistory({
          workOrderId: workOrder.id,
          previousStatus: WorkOrderStatus.RECEIVED,
          newStatus: WorkOrderStatus.IN_DIAGNOSIS,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
        }),
      ],
      new Date('2026-01-01T03:00:00.000Z'),
    );

    await useCase.execute(input);

    expect(cache.delete).toHaveBeenCalledWith([workOrderCacheKey(workOrder.id)]);

    expect(metrics.record).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'work_order.status.duration' }),
      3 * 3600,
      { workOrderStatus: WorkOrderStatus.IN_DIAGNOSIS },
    );
  });

  it('should leave cache and metric untouched when the transaction fails', async () => {
    unitOfWork.executeTransaction.mockRejectedValueOnce(new Error('commit failed'));

    await expect(useCase.execute(input)).rejects.toThrow('commit failed');

    expect(cache.delete).not.toHaveBeenCalled();
    expect(metrics.record).not.toHaveBeenCalled();
  });
});
