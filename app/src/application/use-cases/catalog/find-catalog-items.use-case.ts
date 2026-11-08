import { IFindCatalogItemsUseCase } from '@application/ports/input/catalog/find-catalog-items.use-case.interface';
import {
  FindCatalogItemsOutputDto,
  FindCatalogItemsInputDto,
} from '@application/ports/input/catalog/dto/find-catalog-items.dto';
import { IInventoryCatalogGateway } from '@application/ports/output/gateways/inventory/inventory-catalog-gateway.interface';

export class FindCatalogItemsUseCase implements IFindCatalogItemsUseCase {
  constructor(private readonly inventoryCatalogGateway: IInventoryCatalogGateway) {}

  async execute(input: FindCatalogItemsInputDto): Promise<FindCatalogItemsOutputDto> {
    const [services, partsSupplies] = await Promise.all([
      this.inventoryCatalogGateway.findServicesByIds(input.serviceIds),
      this.inventoryCatalogGateway.findPartsSuppliesByIds(input.partSupplyIds),
    ]);

    return { services, partsSupplies };
  }
}
