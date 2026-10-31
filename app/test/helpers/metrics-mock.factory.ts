import { IMetrics } from '@application/ports/output/services/metrics.service.interface';

export function createMockMetrics(): jest.Mocked<IMetrics> {
  return {
    increment: jest.fn(),
    record: jest.fn(),
  };
}
