import { UpdateWorkOrderStatusUseCase } from '@application/use-cases/work-order/update-work-order-status.use-case';
import { WorkOrderStatus } from '@domain/enums/work-order-status.enum';
import { ResourceNotFoundException } from '@application/exceptions/resource-not-found.exception';
import { BusinessRuleViolationException } from '@domain/exceptions/business-rule-violation.exception';
import { ResourceConflictException } from '@application/exceptions/resource-conflict.exception';
import { createMockWorkOrder } from '../../../../helpers/work-order-mock.factory';
import { createMockUnitOfWorkWithRepos } from '../../../../helpers/unit-of-work-mock.factory';
import { IUnitOfWork, IRepositories } from '@domain/interfaces/repositories/unit-of-work.interface';
import { ILogger } from '@application/ports/output/services/logger.service.interface';
import { createMockLogger } from '../../../../helpers/logger-mock.factory';
import { IMetrics } from '@application/ports/output/services/metrics.service.interface';
import { createMockMetrics } from '../../../../helpers/metrics-mock.factory';
import { StatusHistory } from '@domain/entities/status-history.entity';
import {
  arrangeStatusHistory,
  createMockStatusHistory,
} from '../../../../helpers/status-history-mock.factory';
import { ICache } from '@application/ports/output/services/cache.service.interface';
import { workOrderCacheKey } from '@application/keys/work-order-cache-key';
import { createMockCache } from '../../../../helpers/cache-mock.factory';
import { randomUUID } from 'node:crypto';
import { IBillingPaymentsGateway } from '@application/ports/output/gateways/billing/billing-payments-gateway.interface';
import { ServiceIntegrationException } from '@infrastructure/exceptions/service-integration.exception';
import {
  createMockBillingPaymentsGateway,
  readInternalWorkOrderBalanceFixture,
} from '../../../../helpers/billing-payments-gateway-mock.factory';

describe('UpdateWorkOrderStatusUseCase', () => {
  let billingPaymentsGateway: jest.Mocked<IBillingPaymentsGateway>;
  let cache: jest.Mocked<ICache>;
  let useCase: UpdateWorkOrderStatusUseCase;
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
    billingPaymentsGateway = createMockBillingPaymentsGateway();

    useCase = new UpdateWorkOrderStatusUseCase(
      mockUow,
      logger,
      metrics,
      mockRepos.statusHistory,
      cache,
      mockRepos.workOrder,
      billingPaymentsGateway,
    );
  });

  it('should transition RECEIVED -> IN_DIAGNOSIS', async () => {
    const wo = createMockWorkOrder({ status: WorkOrderStatus.RECEIVED });
    const updated = createMockWorkOrder({ ...wo, status: WorkOrderStatus.IN_DIAGNOSIS });

    (mockRepos.workOrder.findById as jest.Mock).mockResolvedValue(wo);
    (mockRepos.workOrder.update as jest.Mock).mockResolvedValue(updated);
    (mockRepos.statusHistory.create as jest.Mock).mockResolvedValue({});

    const result = await useCase.execute(wo.id, {
      status: WorkOrderStatus.IN_DIAGNOSIS,
      userId: '550e8400-e29b-41d4-a716-446655440099',
    });
    expect(result.status).toBe(WorkOrderStatus.IN_DIAGNOSIS);
  });

  it('should transition RECEIVED -> CANCELLED with notes', async () => {
    const wo = createMockWorkOrder({ status: WorkOrderStatus.RECEIVED });
    const updated = createMockWorkOrder({ ...wo, status: WorkOrderStatus.CANCELLED });

    (mockRepos.workOrder.findById as jest.Mock).mockResolvedValue(wo);
    (mockRepos.workOrder.update as jest.Mock).mockResolvedValue(updated);
    (mockRepos.statusHistory.create as jest.Mock).mockResolvedValue({});

    const result = await useCase.execute(wo.id, {
      status: WorkOrderStatus.CANCELLED,
      notes: 'Cancelado a pedido do cliente',
      userId: '550e8400-e29b-41d4-a716-446655440099',
    });
    expect(result.status).toBe(WorkOrderStatus.CANCELLED);
  });

  describe('delivery', () => {
    it('should deliver when the balance is zero', async () => {
      const wo = createMockWorkOrder({ status: WorkOrderStatus.COMPLETED });
      const updated = createMockWorkOrder({ ...wo, status: WorkOrderStatus.DELIVERED });

      (mockRepos.workOrder.findById as jest.Mock).mockResolvedValue(wo);
      (mockRepos.workOrder.update as jest.Mock).mockResolvedValue(updated);
      (mockRepos.statusHistory.create as jest.Mock).mockResolvedValue({});
      billingPaymentsGateway.getWorkOrderBalance.mockResolvedValue({
        approvedTotal: '500.00',
        paidTotal: '500.00',
        balance: '0.00',
      });

      const result = await useCase.execute(wo.id, {
        status: WorkOrderStatus.DELIVERED,
        userId: '550e8400-e29b-41d4-a716-446655440099',
      });

      expect(result.status).toBe(WorkOrderStatus.DELIVERED);
      expect(billingPaymentsGateway.getWorkOrderBalance).toHaveBeenCalledWith(wo.id);
      expect(mockRepos.workOrder.findById).toHaveBeenCalledTimes(1);
    });

    it('should refuse the delivery when the Billing reports a balance due', async () => {
      const wo = createMockWorkOrder({ status: WorkOrderStatus.COMPLETED });

      jest.mocked(mockRepos.workOrder.findById).mockResolvedValue(wo);
      billingPaymentsGateway.getWorkOrderBalance.mockResolvedValue(
        readInternalWorkOrderBalanceFixture().data,
      );

      await expect(
        useCase.execute(wo.id, {
          status: WorkOrderStatus.DELIVERED,
          userId: '550e8400-e29b-41d4-a716-446655440099',
        }),
      ).rejects.toThrow(
        new ResourceConflictException(
          'Ordem de serviço com saldo a pagar de R$ 400.00: a entrega é liberada depois que o saldo for quitado',
        ),
      );

      expect(mockUow.executeTransaction).not.toHaveBeenCalled();
      expect(mockRepos.workOrder.update).not.toHaveBeenCalled();
      expect(cache.delete).not.toHaveBeenCalled();
    });

    it('should let the Billing outage through without delivering', async () => {
      const wo = createMockWorkOrder({ status: WorkOrderStatus.COMPLETED });
      const outage = new ServiceIntegrationException('Serviço de destino indisponível');

      jest.mocked(mockRepos.workOrder.findById).mockResolvedValue(wo);
      billingPaymentsGateway.getWorkOrderBalance.mockRejectedValue(outage);

      await expect(
        useCase.execute(wo.id, {
          status: WorkOrderStatus.DELIVERED,
          userId: '550e8400-e29b-41d4-a716-446655440099',
        }),
      ).rejects.toBe(outage);

      expect(mockUow.executeTransaction).not.toHaveBeenCalled();
    });

    it.each([
      ['RECEIVED', WorkOrderStatus.RECEIVED, BusinessRuleViolationException],
      ['AWAITING_PAYMENT', WorkOrderStatus.AWAITING_PAYMENT, BusinessRuleViolationException],
      ['missing', null, ResourceNotFoundException],
    ])(
      'should not call the Billing when the work order cannot be delivered (%s)',
      async (_, status, exception) => {
        jest
          .mocked(mockRepos.workOrder.findById)
          .mockResolvedValue(status && createMockWorkOrder({ status }));

        await expect(
          useCase.execute(randomUUID(), {
            status: WorkOrderStatus.DELIVERED,
            userId: '550e8400-e29b-41d4-a716-446655440099',
          }),
        ).rejects.toThrow(exception);

        expect(billingPaymentsGateway.getWorkOrderBalance).not.toHaveBeenCalled();
      },
    );

    it.each([WorkOrderStatus.IN_DIAGNOSIS, WorkOrderStatus.CANCELLED])(
      'should not call the Billing for other statuses (%s)',
      async (status) => {
        const wo = createMockWorkOrder({ status: WorkOrderStatus.RECEIVED });

        jest.mocked(mockRepos.workOrder.findById).mockResolvedValue(wo);
        jest.mocked(mockRepos.workOrder.update).mockResolvedValue(wo);

        await useCase.execute(wo.id, {
          status,
          notes: 'Cancelado a pedido do cliente',
          userId: '550e8400-e29b-41d4-a716-446655440099',
        });

        expect(billingPaymentsGateway.getWorkOrderBalance).not.toHaveBeenCalled();
      },
    );
  });

  it('should throw ResourceNotFoundException when work order not found', async () => {
    (mockRepos.workOrder.findById as jest.Mock).mockResolvedValue(null);

    await expect(
      useCase.execute('bad-id', {
        status: WorkOrderStatus.IN_DIAGNOSIS,
        userId: '550e8400-e29b-41d4-a716-446655440099',
      }),
    ).rejects.toThrow(ResourceNotFoundException);
  });

  it('should throw BusinessRuleViolationException for disallowed status via PATCH', async () => {
    const wo = createMockWorkOrder({ status: WorkOrderStatus.RECEIVED });
    (mockRepos.workOrder.findById as jest.Mock).mockResolvedValue(wo);

    // APPROVED is not in PATCH_STATUS_ALLOWED
    await expect(
      useCase.execute(wo.id, {
        status: WorkOrderStatus.APPROVED,
        userId: '550e8400-e29b-41d4-a716-446655440099',
      }),
    ).rejects.toThrow(BusinessRuleViolationException);
  });

  it('should throw BusinessRuleViolationException when CANCELLED without notes', async () => {
    const wo = createMockWorkOrder({ status: WorkOrderStatus.RECEIVED });
    (mockRepos.workOrder.findById as jest.Mock).mockResolvedValue(wo);

    await expect(
      useCase.execute(wo.id, {
        status: WorkOrderStatus.CANCELLED,
        userId: '550e8400-e29b-41d4-a716-446655440099',
      }),
    ).rejects.toThrow(BusinessRuleViolationException);
  });

  it('should answer 409 when cancelling a work order with a quote approval in progress', async () => {
    const workOrder = createMockWorkOrder({ status: WorkOrderStatus.AWAITING_APPROVAL });

    jest.mocked(mockRepos.workOrder.findById).mockResolvedValue(workOrder);

    jest.mocked(mockRepos.sagaInstance.hasActiveByWorkOrderId).mockResolvedValue(true);

    await expect(
      useCase.execute(workOrder.id, {
        status: WorkOrderStatus.CANCELLED,
        notes: 'Cancelado a pedido do cliente',
        userId: '550e8400-e29b-41d4-a716-446655440099',
      }),
    ).rejects.toThrow(
      new ResourceConflictException(
        'Ordem de serviço com aprovação de orçamento em andamento: aguarde a conclusão e tente novamente',
      ),
    );

    expect(mockRepos.sagaInstance.hasActiveByWorkOrderId).toHaveBeenCalledWith(workOrder.id);
    expect(mockRepos.workOrder.update).not.toHaveBeenCalled();
    expect(mockRepos.statusHistory.create).not.toHaveBeenCalled();
    expect(cache.delete).not.toHaveBeenCalled();
  });

  describe('dwell metrics', () => {
    const RECEIVED_AT = new Date('2026-01-01T00:00:00.000Z');
    const DIAGNOSED_AT = new Date('2026-01-01T02:00:00.000Z');

    function arrangeTransition() {
      const wo = createMockWorkOrder({ status: WorkOrderStatus.RECEIVED });
      const updated = createMockWorkOrder({ ...wo, status: WorkOrderStatus.IN_DIAGNOSIS });

      (mockRepos.workOrder.findById as jest.Mock).mockResolvedValue(wo);
      (mockRepos.workOrder.update as jest.Mock).mockResolvedValue(updated);
      arrangeStatusHistory(
        mockRepos.statusHistory,
        [
          createMockStatusHistory({
            workOrderId: updated.id,
            previousStatus: null,
            newStatus: WorkOrderStatus.RECEIVED,
            createdAt: RECEIVED_AT,
          }),
        ],
        DIAGNOSED_AT,
      );

      return updated;
    }

    it('should record the dwell in the left status, with the status as an attribute', async () => {
      const updated = arrangeTransition();

      await useCase.execute(updated.id, {
        status: WorkOrderStatus.IN_DIAGNOSIS,
        userId: '550e8400-e29b-41d4-a716-446655440099',
      });

      expect(metrics.record).toHaveBeenCalledTimes(1);
      expect(metrics.record).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'work_order.status.duration', unit: 's' }),
        2 * 3600,
        { workOrderStatus: WorkOrderStatus.RECEIVED },
      );
    });

    /**
     * The history read exists only for the metric, which is why it happens
     * **outside** the transaction. Inside it, a failure here would take the
     * business operation down too — with no local fix, because the transaction
     * would already be aborted and the COMMIT would become a silent ROLLBACK.
     */
    it('should read the history after the commit, not inside the transaction', async () => {
      const updated = arrangeTransition();
      const order: string[] = [];

      (mockUow.executeTransaction as jest.Mock).mockImplementation(
        async (work: (repos: IRepositories) => Promise<unknown>) => {
          const result = await work(mockRepos);
          order.push('commit');

          return result;
        },
      );
      (mockRepos.statusHistory.create as jest.Mock).mockImplementation((entry: StatusHistory) => {
        order.push('create');

        return Promise.resolve(entry);
      });
      (mockRepos.statusHistory.findByWorkOrderId as jest.Mock).mockImplementation(() => {
        order.push('read');

        return Promise.resolve([]);
      });

      await useCase.execute(updated.id, {
        status: WorkOrderStatus.IN_DIAGNOSIS,
        userId: '550e8400-e29b-41d4-a716-446655440099',
      });

      expect(order).toEqual(['create', 'commit', 'read']);
    });

    it('should not let a metric read failure break the already committed operation', async () => {
      const updated = arrangeTransition();

      (mockRepos.statusHistory.findByWorkOrderId as jest.Mock).mockRejectedValue(
        new Error('conexão perdida'),
      );

      await expect(
        useCase.execute(updated.id, {
          status: WorkOrderStatus.IN_DIAGNOSIS,
          userId: '550e8400-e29b-41d4-a716-446655440099',
        }),
      ).resolves.toBe(updated);

      expect(metrics.record).not.toHaveBeenCalled();
    });

    it('should not record a metric when the transaction throws', async () => {
      const wo = createMockWorkOrder({ status: WorkOrderStatus.RECEIVED });

      (mockRepos.workOrder.findById as jest.Mock).mockResolvedValue(wo);
      (mockRepos.workOrder.update as jest.Mock).mockRejectedValue(new Error('rollback'));

      await expect(
        useCase.execute(wo.id, {
          status: WorkOrderStatus.IN_DIAGNOSIS,
          userId: '550e8400-e29b-41d4-a716-446655440099',
        }),
      ).rejects.toThrow('rollback');

      expect(metrics.record).not.toHaveBeenCalled();
    });

    it('should emit only after the transaction returns', async () => {
      const updated = arrangeTransition();
      const calls: string[] = [];

      (mockUow.executeTransaction as jest.Mock).mockImplementation(
        async (work: (repos: IRepositories) => Promise<unknown>) => {
          const result = await work(mockRepos);
          calls.push('commit');

          return result;
        },
      );
      metrics.record.mockImplementation(() => {
        calls.push('record');
      });

      await useCase.execute(updated.id, {
        status: WorkOrderStatus.IN_DIAGNOSIS,
        userId: '550e8400-e29b-41d4-a716-446655440099',
      });

      expect(calls).toEqual(['commit', 'record']);
    });
  });

  it('should delete the work order cache keys after the commit', async () => {
    const workOrder = createMockWorkOrder({ status: WorkOrderStatus.RECEIVED });

    (mockRepos.workOrder.findById as jest.Mock).mockResolvedValue(workOrder);

    (mockRepos.workOrder.update as jest.Mock).mockResolvedValue(workOrder);

    (mockRepos.statusHistory.create as jest.Mock).mockResolvedValue({});

    await useCase.execute(workOrder.id, {
      status: WorkOrderStatus.IN_DIAGNOSIS,
      userId: '550e8400-e29b-41d4-a716-446655440099',
    });

    expect(cache.delete).toHaveBeenCalledWith([workOrderCacheKey(workOrder.id)]);

    expect(cache.delete.mock.invocationCallOrder[0]).toBeGreaterThan(
      jest.mocked(mockRepos.workOrder.update).mock.invocationCallOrder[0],
    );
  });

  it('should not touch the cache when the write fails', async () => {
    const workOrder = createMockWorkOrder({ status: WorkOrderStatus.RECEIVED });

    jest.mocked(mockRepos.workOrder.findById).mockResolvedValue(workOrder);
    mockUow.executeTransaction.mockRejectedValueOnce(new Error('commit failed'));

    await expect(
      useCase.execute(workOrder.id, {
        status: WorkOrderStatus.IN_DIAGNOSIS,
        userId: '550e8400-e29b-41d4-a716-446655440099',
      }),
    ).rejects.toThrow('commit failed');

    expect(cache.delete).not.toHaveBeenCalled();
  });
});
