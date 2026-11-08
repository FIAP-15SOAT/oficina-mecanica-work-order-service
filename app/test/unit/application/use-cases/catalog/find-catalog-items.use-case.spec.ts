import { FindCatalogItemsUseCase } from '@application/use-cases/catalog/find-catalog-items.use-case';
import { IInventoryCatalogGateway } from '@application/ports/output/gateways/inventory/inventory-catalog-gateway.interface';

import {
  createMockInventoryCatalogGateway,
  createMockInventoryPartSupplyGatewayResponse,
  createMockInventoryServiceGatewayResponse,
} from '../../../../helpers/inventory-catalog-gateway-mock.factory';

describe('FindCatalogItemsUseCase', () => {
  let useCase: FindCatalogItemsUseCase;
  let inventoryCatalogGateway: jest.Mocked<IInventoryCatalogGateway>;

  beforeEach(() => {
    inventoryCatalogGateway = createMockInventoryCatalogGateway();

    useCase = new FindCatalogItemsUseCase(inventoryCatalogGateway);
  });

  it('should read services and parts in parallel', () => {
    inventoryCatalogGateway.findServicesByIds.mockReturnValue(new Promise(() => undefined));
    inventoryCatalogGateway.findPartsSuppliesByIds.mockReturnValue(new Promise(() => undefined));

    void useCase.execute({ serviceIds: ['service-id'], partSupplyIds: ['part-supply-id'] });

    expect(inventoryCatalogGateway.findServicesByIds).toHaveBeenCalledWith(['service-id']);
    expect(inventoryCatalogGateway.findPartsSuppliesByIds).toHaveBeenCalledWith(['part-supply-id']);
  });

  it('should return only the items the inventory has', async () => {
    const service = createMockInventoryServiceGatewayResponse();
    const partSupply = createMockInventoryPartSupplyGatewayResponse();

    inventoryCatalogGateway.findServicesByIds.mockResolvedValue([service]);
    inventoryCatalogGateway.findPartsSuppliesByIds.mockResolvedValue([partSupply]);

    await expect(
      useCase.execute({
        serviceIds: [service.id, 'missing-service-id'],
        partSupplyIds: [partSupply.id, 'missing-part-id'],
      }),
    ).resolves.toEqual({ services: [service], partsSupplies: [partSupply] });
  });
});
