import { PrismaSagaInstanceRepository } from '@infrastructure/persistence/prisma/repositories/prisma-saga-instance.repository';

import { SagaFailureReason } from '@domain/enums/saga-failure-reason.enum';
import { SagaStatus } from '@domain/enums/saga-status.enum';
import { SagaType } from '@domain/enums/saga-type.enum';

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
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
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
      'should tell whether the work order has a saga reserving stock (%s rows)',
      async (count, expected) => {
        prisma.sagaInstance.count.mockResolvedValue(count);

        const result = await repository.hasActiveByWorkOrderId(record.workOrderId);

        expect(prisma.sagaInstance.count).toHaveBeenCalledWith({
          where: { workOrderId: record.workOrderId, status: SagaStatus.RESERVING_STOCK },
        });

        expect(result).toBe(expected);
      },
    );
  });

  describe('create', () => {
    it('should create', async () => {
      const saga = createMockSagaInstance({ status: SagaStatus.RESERVING_STOCK });

      prisma.sagaInstance.create.mockResolvedValue({
        ...record,
        status: SagaStatus.RESERVING_STOCK,
        failureReason: null,
      });

      const result = await repository.create(saga);

      expect(prisma.sagaInstance.create).toHaveBeenCalledWith({
        data: {
          id: saga.id,
          type: saga.type,
          correlationId: saga.correlationId,
          workOrderId: saga.workOrderId,
          status: SagaStatus.RESERVING_STOCK,
          failureReason: null,
        },
      });

      expect(result).toEqual(saga);
    });
  });

  describe('update', () => {
    it('should update status and failure reason', async () => {
      const saga = createMockSagaInstance({ status: SagaStatus.RESERVING_STOCK });

      saga.compensate(SagaFailureReason.INSUFFICIENT_STOCK);
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
