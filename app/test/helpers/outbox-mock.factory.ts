import { IOutboxRepository } from '@domain/interfaces/repositories/outbox.repository.interface';

export function createMockOutboxRepository(): jest.Mocked<IOutboxRepository> {
  return { add: jest.fn().mockResolvedValue(undefined) };
}
