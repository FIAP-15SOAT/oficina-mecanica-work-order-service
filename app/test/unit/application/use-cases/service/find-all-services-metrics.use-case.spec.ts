import { FindAllServicesMetricsUseCase } from '@application/use-cases/service/find-all-services-metrics.use-case';
import { IInventoryCatalogGateway } from '@application/ports/output/gateways/inventory/inventory-catalog-gateway.interface';
import { IWorkOrderRepository } from '@domain/interfaces/repositories/work-order.repository.interface';
import {
  createMockInventoryCatalogGateway,
  createMockInventoryServiceGatewayResponse,
} from '../../../../helpers/inventory-catalog-gateway-mock.factory';
import { createMockWorkOrderRepository } from '../../../../helpers/work-order-mock.factory';

describe('FindAllServicesMetricsUseCase', () => {
  let useCase: FindAllServicesMetricsUseCase;
  let workOrderRepository: jest.Mocked<IWorkOrderRepository>;
  let inventoryCatalogGateway: jest.Mocked<IInventoryCatalogGateway>;

  beforeEach(() => {
    workOrderRepository = createMockWorkOrderRepository();

    inventoryCatalogGateway = createMockInventoryCatalogGateway();

    useCase = new FindAllServicesMetricsUseCase(workOrderRepository, inventoryCatalogGateway);
  });

  it('should list only executed services, sorted by name and paged', async () => {
    const oilChange = createMockInventoryServiceGatewayResponse({ name: 'Troca de óleo' });

    const alignment = createMockInventoryServiceGatewayResponse({ name: 'Alinhamento' });

    const balancing = createMockInventoryServiceGatewayResponse({ name: 'Balanceamento' });

    workOrderRepository.findAllServiceExecutionMetrics.mockResolvedValue([
      { serviceId: oilChange.id, executionCount: 3, averageTimeMinutes: 40 },
      { serviceId: alignment.id, executionCount: 1, averageTimeMinutes: 60 },
      { serviceId: balancing.id, executionCount: 2, averageTimeMinutes: 30.5 },
    ]);

    inventoryCatalogGateway.findServicesByIds.mockResolvedValue([oilChange, alignment, balancing]);

    const result = await useCase.execute({ page: 1, limit: 2 });

    expect(result).toEqual({
      items: [
        {
          serviceId: alignment.id,
          serviceName: 'Alinhamento',
          executionCount: 1,
          averageTimeMinutes: 60,
        },
        {
          serviceId: balancing.id,
          serviceName: 'Balanceamento',
          executionCount: 2,
          averageTimeMinutes: 30.5,
        },
      ],
      pagination: { totalRecords: 3, totalPages: 2, page: 1, limit: 2 },
    });

    expect(inventoryCatalogGateway.findServicesByIds).toHaveBeenCalledWith([
      oilChange.id,
      alignment.id,
      balancing.id,
    ]);
  });

  it('should list a service the Inventory no longer has last, with a null name', async () => {
    const alignment = createMockInventoryServiceGatewayResponse({ name: 'Alinhamento' });

    const balancing = createMockInventoryServiceGatewayResponse({ name: 'Balanceamento' });

    workOrderRepository.findAllServiceExecutionMetrics.mockResolvedValue([
      { serviceId: balancing.id, executionCount: 2, averageTimeMinutes: 30 },
      { serviceId: 'removed-service-id', executionCount: 1, averageTimeMinutes: 20 },
      { serviceId: alignment.id, executionCount: 1, averageTimeMinutes: 60 },
    ]);

    inventoryCatalogGateway.findServicesByIds.mockResolvedValue([alignment, balancing]);

    const result = await useCase.execute({ page: 1, limit: 10 });

    expect(result.items.map(({ serviceId, serviceName }) => ({ serviceId, serviceName }))).toEqual([
      { serviceId: alignment.id, serviceName: 'Alinhamento' },
      { serviceId: balancing.id, serviceName: 'Balanceamento' },
      { serviceId: 'removed-service-id', serviceName: null },
    ]);
  });

  it('should return a zero average when the repository has no measured time', async () => {
    const alignment = createMockInventoryServiceGatewayResponse({ name: 'Alinhamento' });

    workOrderRepository.findAllServiceExecutionMetrics.mockResolvedValue([
      { serviceId: alignment.id, executionCount: 1, averageTimeMinutes: null },
    ]);

    inventoryCatalogGateway.findServicesByIds.mockResolvedValue([alignment]);

    const result = await useCase.execute({ page: 1, limit: 10 });

    expect(result.items[0].averageTimeMinutes).toBe(0);
  });
});
