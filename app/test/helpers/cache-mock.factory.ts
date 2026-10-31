import { ICache } from '@application/ports/output/services/cache.service.interface';

export function createMockCache(): jest.Mocked<ICache> {
  return {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn().mockResolvedValue(undefined),
  };
}
