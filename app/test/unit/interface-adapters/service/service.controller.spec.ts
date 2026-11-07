import { randomUUID } from 'node:crypto';

import { ServiceController } from '@interface-adapters/service/service.controller';

import { ICreateServiceUseCase } from '@application/ports/input/service/create-service.use-case.interface';
import { IFindServiceByIdUseCase } from '@application/ports/input/service/find-service-by-id.use-case.interface';
import { IFindAllServicesPaginatedUseCase } from '@application/ports/input/service/find-all-services-paginated.use-case.interface';
import { IUpdateServiceUseCase } from '@application/ports/input/service/update-service.use-case.interface';
import { IDeleteServiceUseCase } from '@application/ports/input/service/delete-service.use-case.interface';
import { IFindServiceMetricsUseCase } from '@application/ports/input/service/find-service-metrics.use-case.interface';
import { IFindAllServicesMetricsUseCase } from '@application/ports/input/service/find-all-services-metrics.use-case.interface';

import { ServicePresenter } from '@interface-adapters/service/service.presenter';
import { ServiceMetricsPresenter } from '@interface-adapters/service/service-metrics.presenter';

import { CreateServiceRequest } from '@interface-adapters/service/requests/create-service-request';
import { UpdateServiceRequest } from '@interface-adapters/service/requests/update-service-request';
import { ServiceMetrics } from '@application/ports/input/service/dto/find-service-metrics.dto';

import { createMockService } from '../../../helpers/service-mock.factory';

describe('ServiceController', () => {
  let controller: ServiceController;
  let createUseCase: jest.Mocked<ICreateServiceUseCase>;
  let findByIdUseCase: jest.Mocked<IFindServiceByIdUseCase>;
  let findAllPaginatedUseCase: jest.Mocked<IFindAllServicesPaginatedUseCase>;
  let updateUseCase: jest.Mocked<IUpdateServiceUseCase>;
  let deleteUseCase: jest.Mocked<IDeleteServiceUseCase>;
  let findMetricsUseCase: jest.Mocked<IFindServiceMetricsUseCase>;
  let findAllMetricsUseCase: jest.Mocked<IFindAllServicesMetricsUseCase>;

  const createRequestStub: CreateServiceRequest = {
    name: 'Troca de óleo',
    description: 'Troca de óleo com filtro',
    basePrice: 129.9,
    estimatedTimeMin: 60,
  };

  beforeEach(() => {
    createUseCase = { execute: jest.fn() };
    findByIdUseCase = { execute: jest.fn() };
    findAllPaginatedUseCase = { execute: jest.fn() };
    updateUseCase = { execute: jest.fn() };
    deleteUseCase = { execute: jest.fn() };
    findMetricsUseCase = { execute: jest.fn() };
    findAllMetricsUseCase = { execute: jest.fn() };

    controller = new ServiceController(
      createUseCase,
      findByIdUseCase,
      findAllPaginatedUseCase,
      updateUseCase,
      deleteUseCase,
      findMetricsUseCase,
      findAllMetricsUseCase,
    );
  });

  describe('create', () => {
    it('should return service wrapped in data', async () => {
      const created = createMockService(createRequestStub);
      createUseCase.execute.mockResolvedValue(created);

      const result = await controller.create(createRequestStub);

      expect(result).toEqual(ServicePresenter.toDataResponse(created));
      expect(createUseCase.execute).toHaveBeenCalledWith(createRequestStub);
    });
  });

  describe('findAll', () => {
    it('should default page and limit when missing and forward filters', async () => {
      const services = [createMockService(), createMockService()];
      findAllPaginatedUseCase.execute.mockResolvedValue({
        items: services,
        pagination: { totalRecords: 2, totalPages: 1, page: 1, limit: 10 },
      });

      const result = await controller.findAll({ name: 'Troca' });

      expect(result).toEqual(
        ServicePresenter.toPaginatedDataResponse({
          items: services,
          pagination: { totalRecords: 2, totalPages: 1, page: 1, limit: 10 },
        }),
      );

      expect(findAllPaginatedUseCase.execute).toHaveBeenCalledWith({
        page: 1,
        limit: 10,
        name: 'Troca',
      });
    });

    it('should forward provided page and limit', async () => {
      findAllPaginatedUseCase.execute.mockResolvedValue({
        items: [],
        pagination: { totalRecords: 0, totalPages: 0, page: 2, limit: 5 },
      });

      await controller.findAll({ page: 2, limit: 5 });

      expect(findAllPaginatedUseCase.execute).toHaveBeenCalledWith({ page: 2, limit: 5 });
    });
  });

  describe('findById', () => {
    it('should return service wrapped in data', async () => {
      const service = createMockService();
      findByIdUseCase.execute.mockResolvedValue(service);

      const result = await controller.findById(service.id);

      expect(result).toEqual(ServicePresenter.toDataResponse(service));
      expect(findByIdUseCase.execute).toHaveBeenCalledWith(service.id);
    });
  });

  describe('update', () => {
    it('should return updated service wrapped in data', async () => {
      const updateRequest: UpdateServiceRequest = { ...createRequestStub, name: 'Troca premium' };
      const updated = createMockService(updateRequest);

      updateUseCase.execute.mockResolvedValue(updated);

      const result = await controller.update(updated.id, updateRequest);

      expect(result).toEqual(ServicePresenter.toDataResponse(updated));
      expect(updateUseCase.execute).toHaveBeenCalledWith(updated.id, updateRequest);
    });
  });

  describe('remove', () => {
    it('should call the delete use case with the correct id', async () => {
      const id = randomUUID();
      deleteUseCase.execute.mockResolvedValue(undefined);

      await controller.remove(id);

      expect(deleteUseCase.execute).toHaveBeenCalledWith(id);
    });
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
