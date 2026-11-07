import { randomUUID } from 'node:crypto';

import { ServiceMetrics } from '@application/ports/input/service/dto/find-service-metrics.dto';
import { ServiceMetricsPresenter } from '@interface-adapters/service/service-metrics.presenter';

describe('ServiceMetricsPresenter', () => {
  const metricsStub: ServiceMetrics = {
    serviceId: randomUUID(),
    serviceName: 'Troca de óleo',
    executionCount: 10,
    averageTimeMinutes: 45,
  };

  describe('toResponse', () => {
    it('should map all metrics fields correctly', () => {
      const response = ServiceMetricsPresenter.toResponse(metricsStub);

      expect(response).toEqual(metricsStub);
    });
  });

  describe('toDataResponse', () => {
    it('should wrap the metrics response in a data property', () => {
      const result = ServiceMetricsPresenter.toDataResponse(metricsStub);

      expect(result.data).toEqual(metricsStub);
    });
  });

  describe('toPaginatedDataResponse', () => {
    it('should map items and preserve pagination metadata', () => {
      const pagination = { totalRecords: 1, totalPages: 1, page: 1, limit: 10 };

      const result = ServiceMetricsPresenter.toPaginatedDataResponse({
        items: [metricsStub],
        pagination,
      });

      expect(result.data).toEqual([metricsStub]);
      expect(result.pagination).toEqual(pagination);
    });

    it('should return empty data array when items is empty', () => {
      const result = ServiceMetricsPresenter.toPaginatedDataResponse({
        items: [],
        pagination: { totalRecords: 0, totalPages: 0, page: 1, limit: 10 },
      });

      expect(result.data).toHaveLength(0);
    });
  });
});
