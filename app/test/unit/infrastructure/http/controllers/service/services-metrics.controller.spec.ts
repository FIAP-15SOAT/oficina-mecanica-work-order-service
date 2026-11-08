import { randomUUID } from 'node:crypto';

import { ServicesMetricsController } from '@infrastructure/http/controllers/service/services-metrics.controller';

import { ServiceController as ServiceCleanController } from '@interface-adapters/service/service.controller';
import { ServiceMetricsPresenter } from '@interface-adapters/service/service-metrics.presenter';

import { PaginationDto } from '@infrastructure/http/common/dto/pagination.dto';
import { ServiceMetrics } from '@application/ports/input/service/dto/find-service-metrics.dto';

describe('ServicesMetricsController', () => {
  let httpController: ServicesMetricsController;
  let cleanController: ServiceCleanController;

  beforeEach(() => {
    cleanController = new ServiceCleanController({ execute: jest.fn() }, { execute: jest.fn() });
    httpController = new ServicesMetricsController(cleanController);
  });

  describe('getAllMetrics', () => {
    it('should pass the query straight to the clean controller and return its result', async () => {
      const query: PaginationDto = { page: 1, limit: 10 };
      const metrics: ServiceMetrics[] = [
        {
          serviceId: randomUUID(),
          serviceName: 'Troca de óleo',
          executionCount: 5,
          averageTimeMinutes: 20,
        },
      ];

      const response = ServiceMetricsPresenter.toPaginatedDataResponse({
        items: metrics,
        pagination: { totalRecords: 1, totalPages: 1, page: 1, limit: 10 },
      });

      jest.spyOn(cleanController, 'getAllMetrics').mockResolvedValue(response);

      const result = await httpController.getAllMetrics(query);

      expect(result).toBe(response);
      expect(cleanController.getAllMetrics).toHaveBeenCalledWith(query);
    });
  });
});
