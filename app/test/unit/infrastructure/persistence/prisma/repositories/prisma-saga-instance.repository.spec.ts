import { PrismaSagaInstanceRepository } from '@infrastructure/persistence/prisma/repositories/prisma-saga-instance.repository';

import { SagaInstance } from '@domain/entities/saga-instance.entity';
import { SagaFailureReason } from '@domain/enums/saga-failure-reason.enum';
import { SagaStatus } from '@domain/enums/saga-status.enum';
import { SagaType } from '@domain/enums/saga-type.enum';
import { WorkOrderStatus } from '@domain/enums/work-order-status.enum';

import {
  createMockPrismaClient,
  MockPrismaService,
} from '../../../../../helpers/prisma-mock.factory';
import { createMockSagaInstance } from '../../../../../helpers/saga-instance-mock.factory';

describe('PrismaSagaInstanceRepository', () => {
  let repository: PrismaSagaInstanceRepository;
  let prisma: MockPrismaService;

  const record = {
    id: '6d1f2a3b-4c5d-4e6f-8a7b-9c0d1e2f3a4b',
    type: SagaType.QUOTE_APPROVAL,
    correlationId: '7e2a3b4c-5d6e-4f7a-8b9c-0d1e2f3a4b5c',
    workOrderId: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
    status: SagaStatus.COMPENSATED,
    failureReason: SagaFailureReason.INSUFFICIENT_STOCK,
    originStatus: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:05:00.000Z'),
  };

  beforeEach(() => {
    prisma = createMockPrismaClient();

    repository = new PrismaSagaInstanceRepository(prisma);
  });

  describe('findByTypeAndCorrelationId', () => {
    it('should find a saga by type and correlation id', async () => {
      prisma.sagaInstance.findUnique.mockResolvedValue(record);

      const result = await repository.findByTypeAndCorrelationId(
        SagaType.QUOTE_APPROVAL,
        record.correlationId,
      );

      expect(prisma.sagaInstance.findUnique).toHaveBeenCalledWith({
        where: {
          type_correlationId: {
            type: SagaType.QUOTE_APPROVAL,
            correlationId: record.correlationId,
          },
        },
      });

      expect(result).toEqual(createMockSagaInstance(record));
    });

    it('should return null when no saga matches', async () => {
      prisma.sagaInstance.findUnique.mockResolvedValue(null);

      const result = await repository.findByTypeAndCorrelationId(
        SagaType.QUOTE_APPROVAL,
        record.correlationId,
      );

      expect(result).toBeNull();
    });
  });

  describe('hasActiveByWorkOrderId', () => {
    it.each([
      [1, true],
      [0, false],
    ])(
      'should tell whether the work order has a saga reserving stock or compensating (%s rows)',
      async (count, expected) => {
        prisma.sagaInstance.count.mockResolvedValue(count);

        const result = await repository.hasActiveByWorkOrderId(record.workOrderId);

        expect(prisma.sagaInstance.count).toHaveBeenCalledWith({
          where: {
            workOrderId: record.workOrderId,
            status: { in: [SagaStatus.RESERVING_STOCK, SagaStatus.COMPENSATING] },
          },
        });

        expect(result).toBe(expected);
      },
    );
  });

  describe('create', () => {
    it('should create with the origin status and the creation timestamp of the saga', async () => {
      const saga = SagaInstance.create({
        type: SagaType.PAYMENT,
        correlationId: record.correlationId,
        workOrderId: record.workOrderId,
        status: SagaStatus.AWAITING_PAYMENT,
        originStatus: WorkOrderStatus.APPROVED,
      });

      prisma.sagaInstance.create.mockResolvedValue({
        ...record,
        id: saga.id,
        type: SagaType.PAYMENT,
        status: SagaStatus.AWAITING_PAYMENT,
        failureReason: null,
        originStatus: WorkOrderStatus.APPROVED,
        createdAt: saga.createdAt,
      });

      const result = await repository.create(saga);

      expect(prisma.sagaInstance.create).toHaveBeenCalledWith({
        data: {
          id: saga.id,
          type: SagaType.PAYMENT,
          correlationId: saga.correlationId,
          workOrderId: saga.workOrderId,
          status: SagaStatus.AWAITING_PAYMENT,
          failureReason: null,
          originStatus: WorkOrderStatus.APPROVED,
          createdAt: saga.createdAt,
        },
      });

      expect(result.originStatus).toBe(WorkOrderStatus.APPROVED);
      expect(result.createdAt).toBe(saga.createdAt);
      expect(result.updatedAt).toBe(record.updatedAt);
    });
  });

  describe('update', () => {
    it('should update status and failure reason', async () => {
      const saga = createMockSagaInstance({
        status: SagaStatus.COMPENSATING,
        failureReason: SagaFailureReason.INSUFFICIENT_STOCK,
      });

      saga.compensate();
      prisma.sagaInstance.update.mockResolvedValue(record);

      const result = await repository.update(saga);

      expect(prisma.sagaInstance.update).toHaveBeenCalledWith({
        where: { id: saga.id },
        data: {
          status: SagaStatus.COMPENSATED,
          failureReason: SagaFailureReason.INSUFFICIENT_STOCK,
        },
      });

      expect(result).toEqual(saga);
    });
  });
});
