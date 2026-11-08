import { randomUUID } from 'node:crypto';

import { ServiceController } from '@interface-adapters/service/service.controller';
import { ServiceMetricsPresenter } from '@interface-adapters/service/service-metrics.presenter';

import { IFindServiceMetricsUseCase } from '@application/ports/input/service/find-service-metrics.use-case.interface';
import { IFindAllServicesMetricsUseCase } from '@application/ports/input/service/find-all-services-metrics.use-case.interface';
import { ServiceMetrics } from '@application/ports/input/service/dto/find-service-metrics.dto';

describe('ServiceController', () => {
  let controller: ServiceController;
  let findMetricsUseCase: jest.Mocked<IFindServiceMetricsUseCase>;
  let findAllMetricsUseCase: jest.Mocked<IFindAllServicesMetricsUseCase>;

  beforeEach(() => {
    findMetricsUseCase = { execute: jest.fn() };

    findAllMetricsUseCase = { execute: jest.fn() };

    controller = new ServiceController(findMetricsUseCase, findAllMetricsUseCase);
  });

  describe('getMetrics', () => {
    it('should return metrics for a service wrapped in data', async () => {
      const metrics: ServiceMetrics = {
        serviceId: randomUUID(),
        serviceName: 'Troca de óleo',
        executionCount: 10,
        averageTimeMinutes: 45,
      };

      findMetricsUseCase.execute.mockResolvedValue(metrics);

      const result = await controller.getMetrics(metrics.serviceId);

      expect(result).toEqual(ServiceMetricsPresenter.toDataResponse(metrics));
      expect(findMetricsUseCase.execute).toHaveBeenCalledWith(metrics.serviceId);
    });
  });

  describe('getAllMetrics', () => {
    it('should default page and limit when missing', async () => {
      const metrics: ServiceMetrics[] = [
        {
          serviceId: randomUUID(),
          serviceName: 'Troca de óleo',
          executionCount: 5,
          averageTimeMinutes: 20,
        },
      ];

      findAllMetricsUseCase.execute.mockResolvedValue({
        items: metrics,
        pagination: { totalRecords: 1, totalPages: 1, page: 1, limit: 10 },
      });

      const result = await controller.getAllMetrics({});

      expect(result).toEqual(
        ServiceMetricsPresenter.toPaginatedDataResponse({
          items: metrics,
          pagination: { totalRecords: 1, totalPages: 1, page: 1, limit: 10 },
        }),
      );
      expect(findAllMetricsUseCase.execute).toHaveBeenCalledWith({ page: 1, limit: 10 });
    });

    it('should forward provided page and limit', async () => {
      findAllMetricsUseCase.execute.mockResolvedValue({
        items: [],
        pagination: { totalRecords: 0, totalPages: 0, page: 2, limit: 5 },
      });

      await controller.getAllMetrics({ page: 2, limit: 5 });

      expect(findAllMetricsUseCase.execute).toHaveBeenCalledWith({ page: 2, limit: 5 });
    });
  });
});
