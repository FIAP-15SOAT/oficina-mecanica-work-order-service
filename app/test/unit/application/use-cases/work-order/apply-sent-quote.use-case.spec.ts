import { randomUUID } from 'node:crypto';

import { Customer } from '@domain/entities/customer.entity';
import { WorkOrder } from '@domain/entities/work-order.entity';
import { WorkOrderStatus } from '@domain/enums/work-order-status.enum';
import { IRepositories, IUnitOfWork } from '@domain/interfaces/repositories/unit-of-work.interface';
import { Email } from '@domain/value-objects/email.vo';

import { workOrderCacheKey } from '@application/keys/work-order-cache-key';
import { BUSINESS_EVENTS } from '@application/logging/business-event.catalog';
import { ApplySentQuoteInputDto } from '@application/ports/input/work-order/dto/apply-sent-quote.dto';
import { ICache } from '@application/ports/output/services/cache.service.interface';
import { IIdentityUsersGateway } from '@application/ports/output/gateways/identity/identity-users-gateway.interface';
import { IEmailSenderService } from '@application/ports/output/services/email-sender.service.interface';
import { ILogger } from '@application/ports/output/services/logger.service.interface';
import { IMetrics } from '@application/ports/output/services/metrics.service.interface';
import { ApplySentQuoteUseCase } from '@application/use-cases/work-order/apply-sent-quote.use-case';

import { createMockCache } from '../../../../helpers/cache-mock.factory';
import { createMockCustomer } from '../../../../helpers/customer-mock.factory';
import { createMockLogger } from '../../../../helpers/logger-mock.factory';
import { createMockMetrics } from '../../../../helpers/metrics-mock.factory';
import {
  arrangeStatusHistory,
  createMockStatusHistory,
} from '../../../../helpers/status-history-mock.factory';
import {
  createMockIdentityUserGatewayResponse,
  createMockIdentityUsersGateway,
} from '../../../../helpers/identity-users-gateway-mock.factory';
import { createMockUnitOfWorkWithRepos } from '../../../../helpers/unit-of-work-mock.factory';
import { createMockWorkOrder } from '../../../../helpers/work-order-mock.factory';

describe('ApplySentQuoteUseCase', () => {
  let useCase: ApplySentQuoteUseCase;
  let unitOfWork: jest.Mocked<IUnitOfWork>;
  let repos: jest.Mocked<IRepositories>;
  let emailSender: jest.Mocked<IEmailSenderService>;
  let logger: jest.Mocked<ILogger>;
  let metrics: jest.Mocked<IMetrics>;
  let cache: jest.Mocked<ICache>;
  let identityUsersGateway: jest.Mocked<IIdentityUsersGateway>;
  let customer: Customer;
  let workOrder: WorkOrder;
  let input: ApplySentQuoteInputDto;

  beforeEach(() => {
    ({ unitOfWork, repos } = createMockUnitOfWorkWithRepos());

    emailSender = { send: jest.fn().mockResolvedValue(undefined) };

    logger = createMockLogger();

    metrics = createMockMetrics();

    cache = createMockCache();

    identityUsersGateway = createMockIdentityUsersGateway();

    customer = createMockCustomer({
      name: 'Maria Souza',
      email: Email.create('maria@example.com'),
    });

    workOrder = createMockWorkOrder({
      customerId: customer.id,
      status: WorkOrderStatus.IN_DIAGNOSIS,
    });

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

    jest.mocked(repos.workOrder.findById).mockResolvedValue(workOrder);

    jest.mocked(repos.customer.findById).mockResolvedValue(customer);

    jest.mocked(repos.userCustomer.findUserIdsByCustomerId).mockResolvedValue([]);

    identityUsersGateway.findByIds.mockResolvedValue([]);

    useCase = new ApplySentQuoteUseCase(
      unitOfWork,
      emailSender,
      logger,
      metrics,
      repos.statusHistory,
      cache,
      identityUsersGateway,
    );
  });

  it.each([WorkOrderStatus.IN_DIAGNOSIS, WorkOrderStatus.REJECTED])(
    'should move a work order in %s to AWAITING_APPROVAL with the sender in the history',
    async (status) => {
      const sentWorkOrder = createMockWorkOrder({ customerId: customer.id, status });

      jest.mocked(repos.workOrder.findById).mockResolvedValue(sentWorkOrder);

      await useCase.execute({ ...input, workOrderId: sentWorkOrder.id });

      expect(repos.workOrder.findById).toHaveBeenCalledWith(sentWorkOrder.id);
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

  it('should keep a work order already awaiting approval and still e-mail the quote', async () => {
    const awaitingWorkOrder = createMockWorkOrder({
      customerId: customer.id,
      status: WorkOrderStatus.AWAITING_APPROVAL,
    });

    jest.mocked(repos.workOrder.findById).mockResolvedValue(awaitingWorkOrder);

    await useCase.execute({ ...input, workOrderId: awaitingWorkOrder.id });

    expect(repos.workOrder.update).not.toHaveBeenCalled();
    expect(repos.statusHistory.create).not.toHaveBeenCalled();
    expect(cache.delete).not.toHaveBeenCalled();

    expect(emailSender.send).toHaveBeenCalledWith(
      expect.objectContaining({ toEmail: 'maria@example.com' }),
    );
  });

  it('should e-mail the active linked users with the items and total of the event', async () => {
    const linkedUsers = [
      createMockIdentityUserGatewayResponse({ name: 'João Lima', email: 'joao@example.com' }),
      createMockIdentityUserGatewayResponse({ email: 'inactive@example.com', isActive: false }),
    ];

    jest
      .mocked(repos.userCustomer.findUserIdsByCustomerId)
      .mockResolvedValue(linkedUsers.map((user) => user.id));
    identityUsersGateway.findByIds.mockResolvedValue(linkedUsers);

    await useCase.execute(input);

    expect(repos.userCustomer.findUserIdsByCustomerId).toHaveBeenCalledWith(customer.id);
    expect(identityUsersGateway.findByIds).toHaveBeenCalledWith(linkedUsers.map((user) => user.id));
    expect(emailSender.send).toHaveBeenCalledTimes(1);

    const [email] = emailSender.send.mock.calls[0];

    expect(email).toEqual(
      expect.objectContaining({
        toEmail: 'joao@example.com',
        toName: 'João Lima',
        subject: `Orçamento para Ordem de Serviço ${workOrder.number.toString()} - Aguardando sua aprovação`,
      }),
    );

    expect(email.message.text).toContain(
      'Troca de óleo: 1 x R$ 200.00\nFiltro de óleo: 3 x R$ 50.00\nValor total: R$ 350.00',
    );

    expect(email.message.text).toContain('Acesse o sistema autenticando com seu CPF e senha');

    expect(email.message.html).toContain(
      '<ul><li>Troca de óleo: 1 x R$ 200.00</li><li>Filtro de óleo: 3 x R$ 50.00</li></ul>',
    );

    expect(email.message.html).toContain('<strong>Valor total:</strong> R$ 350.00');
  });

  it('should e-mail the customer when no active user is linked', async () => {
    await useCase.execute(input);

    expect(emailSender.send).toHaveBeenCalledTimes(1);

    const [email] = emailSender.send.mock.calls[0];

    expect(email).toEqual(
      expect.objectContaining({ toEmail: 'maria@example.com', toName: 'Maria Souza' }),
    );

    expect(email.message.text).toContain('Entre em contato com a oficina');
    expect(email.message.html).toContain('<strong>Entre em contato com a oficina</strong>');
  });

  it('should keep the transition when an e-mail fails', async () => {
    const linkedUsers = [
      createMockIdentityUserGatewayResponse({ email: 'first@example.com' }),
      createMockIdentityUserGatewayResponse({ email: 'second@example.com' }),
    ];

    jest
      .mocked(repos.userCustomer.findUserIdsByCustomerId)
      .mockResolvedValue(linkedUsers.map((user) => user.id));
    identityUsersGateway.findByIds.mockResolvedValue(linkedUsers);

    emailSender.send.mockRejectedValueOnce(new Error('smtp down'));

    await expect(useCase.execute(input)).resolves.toBeUndefined();

    expect(workOrder.status).toBe(WorkOrderStatus.AWAITING_APPROVAL);
    expect(cache.delete).toHaveBeenCalledWith([workOrderCacheKey(workOrder.id)]);

    expect(emailSender.send).toHaveBeenCalledWith(
      expect.objectContaining({ toEmail: 'second@example.com' }),
    );
  });

  it.each([WorkOrderStatus.CANCELLED, WorkOrderStatus.RECEIVED])(
    'should skip a work order in %s without e-mailing anyone',
    async (status) => {
      const outsideWorkOrder = createMockWorkOrder({ customerId: customer.id, status });

      jest.mocked(repos.workOrder.findById).mockResolvedValue(outsideWorkOrder);

      await useCase.execute({ ...input, workOrderId: outsideWorkOrder.id });

      expect(outsideWorkOrder.status).toBe(status);
      expect(repos.workOrder.update).not.toHaveBeenCalled();
      expect(repos.statusHistory.create).not.toHaveBeenCalled();
      expect(emailSender.send).not.toHaveBeenCalled();
      expect(cache.delete).not.toHaveBeenCalled();

      expect(logger.event).toHaveBeenCalledWith(BUSINESS_EVENTS.QUOTE_EVENT_SKIPPED, {
        quoteId: input.quoteId,
        workOrderId: outsideWorkOrder.id,
        currentWorkOrderStatus: status,
      });
    },
  );

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

  it('should leave cache, metric and e-mail untouched when the transaction fails', async () => {
    unitOfWork.executeTransaction.mockRejectedValueOnce(new Error('commit failed'));

    await expect(useCase.execute(input)).rejects.toThrow('commit failed');

    expect(cache.delete).not.toHaveBeenCalled();
    expect(metrics.record).not.toHaveBeenCalled();
    expect(emailSender.send).not.toHaveBeenCalled();
  });
});
