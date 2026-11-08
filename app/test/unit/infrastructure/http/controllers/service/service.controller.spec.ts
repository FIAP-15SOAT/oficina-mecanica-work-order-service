import { randomUUID } from 'node:crypto';

import { ServiceController } from '@infrastructure/http/controllers/service/service.controller';
import { ServiceController as ServiceCleanController } from '@interface-adapters/service/service.controller';
import { ServiceMetricsPresenter } from '@interface-adapters/service/service-metrics.presenter';

import { ServiceMetrics } from '@application/ports/input/service/dto/find-service-metrics.dto';

describe('ServiceController', () => {
  let httpController: ServiceController;
  let cleanController: ServiceCleanController;

  beforeEach(() => {
    cleanController = new ServiceCleanController({ execute: jest.fn() }, { execute: jest.fn() });
    httpController = new ServiceController(cleanController);
  });

  describe('getMetrics', () => {
    it('should delegate to the clean controller and return its result', async () => {
      const metrics: ServiceMetrics = {
        serviceId: randomUUID(),
        serviceName: 'Troca de óleo',
        executionCount: 10,
        averageTimeMinutes: 45,
      };

      const response = ServiceMetricsPresenter.toDataResponse(metrics);

      jest.spyOn(cleanController, 'getMetrics').mockResolvedValue(response);

      const result = await httpController.getMetrics(metrics.serviceId);

      expect(result).toBe(response);
      expect(cleanController.getMetrics).toHaveBeenCalledWith(metrics.serviceId);
    });
  });
});
