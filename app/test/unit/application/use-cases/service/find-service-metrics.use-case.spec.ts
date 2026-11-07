import { FindServiceMetricsUseCase } from '@application/use-cases/service/find-service-metrics.use-case';
import { ResourceNotFoundException } from '@application/exceptions/resource-not-found.exception';
import { IInventoryCatalogGateway } from '@application/ports/output/gateways/inventory/inventory-catalog-gateway.interface';
import { IWorkOrderRepository } from '@domain/interfaces/repositories/work-order.repository.interface';
import {
  createMockInventoryCatalogGateway,
  createMockInventoryServiceGatewayResponse,
} from '../../../../helpers/inventory-catalog-gateway-mock.factory';
import { createMockWorkOrderRepository } from '../../../../helpers/work-order-mock.factory';

describe('FindServiceMetricsUseCase', () => {
  let useCase: FindServiceMetricsUseCase;
  let workOrderRepository: jest.Mocked<IWorkOrderRepository>;
  let inventoryCatalogGateway: jest.Mocked<IInventoryCatalogGateway>;

  beforeEach(() => {
    workOrderRepository = createMockWorkOrderRepository();

    inventoryCatalogGateway = createMockInventoryCatalogGateway();

    useCase = new FindServiceMetricsUseCase(workOrderRepository, inventoryCatalogGateway);
  });

  it('should return the executions of a known service with its Inventory name', async () => {
    const service = createMockInventoryServiceGatewayResponse();

    inventoryCatalogGateway.findServicesByIds.mockResolvedValue([service]);

    workOrderRepository.findServiceExecutionMetrics.mockResolvedValue({
      serviceId: service.id,
      executionCount: 10,
      averageTimeMinutes: 45,
    });

    const result = await useCase.execute(service.id);

    expect(result).toEqual({
      serviceId: service.id,
      serviceName: service.name,
      executionCount: 10,
      averageTimeMinutes: 45,
    });

    expect(inventoryCatalogGateway.findServicesByIds).toHaveBeenCalledWith([service.id]);
    expect(workOrderRepository.findServiceExecutionMetrics).toHaveBeenCalledWith(service.id);
  });

  it('should return a zero average when the service has no completed execution', async () => {
    const service = createMockInventoryServiceGatewayResponse();

    inventoryCatalogGateway.findServicesByIds.mockResolvedValue([service]);

    workOrderRepository.findServiceExecutionMetrics.mockResolvedValue({
      serviceId: service.id,
      executionCount: 0,
      averageTimeMinutes: null,
    });

    const result = await useCase.execute(service.id);

    expect(result.averageTimeMinutes).toBe(0);
  });

  it('should answer 404 when the Inventory does not know the service', async () => {
    inventoryCatalogGateway.findServicesByIds.mockResolvedValue([]);

    const execution = useCase.execute('unknown-service-id');

    await expect(execution).rejects.toThrow(ResourceNotFoundException);

    expect(workOrderRepository.findServiceExecutionMetrics).not.toHaveBeenCalled();
  });
});
