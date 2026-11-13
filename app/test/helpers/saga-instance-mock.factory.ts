import { SagaInstance } from '@domain/entities/saga-instance.entity';
import { SagaStatus } from '@domain/enums/saga-status.enum';
import { SagaType } from '@domain/enums/saga-type.enum';
import { ISagaInstanceRepository } from '@domain/interfaces/repositories/saga-instance.repository.interface';

export function createMockSagaInstance(overrides: Partial<SagaInstance> = {}): SagaInstance {
  return SagaInstance.reconstitute({
    id: overrides.id ?? '6d1f2a3b-4c5d-4e6f-8a7b-9c0d1e2f3a4b',
    type: overrides.type ?? SagaType.QUOTE_APPROVAL,
    correlationId: overrides.correlationId ?? '7e2a3b4c-5d6e-4f7a-8b9c-0d1e2f3a4b5c',
    workOrderId: overrides.workOrderId ?? '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
    status: overrides.status ?? SagaStatus.RESERVING_STOCK,
    failureReason: overrides.failureReason ?? null,
    originStatus: overrides.originStatus ?? null,
    createdAt: overrides.createdAt ?? new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: overrides.updatedAt ?? new Date('2026-01-01T00:05:00.000Z'),
  });
}

export function createMockSagaInstanceRepository(): jest.Mocked<ISagaInstanceRepository> {
  return {
    findByTypeAndCorrelationId: jest.fn().mockResolvedValue(null),
    hasActiveByWorkOrderId: jest.fn().mockResolvedValue(false),
    create: jest.fn().mockImplementation((saga: SagaInstance) => Promise.resolve(saga)),
    update: jest.fn().mockImplementation((saga: SagaInstance) => Promise.resolve(saga)),
  };
}
