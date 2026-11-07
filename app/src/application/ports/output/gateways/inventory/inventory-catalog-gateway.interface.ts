import {
  InventoryPartSupplyGatewayResponse,
  InventoryServiceGatewayResponse,
} from './inventory-catalog-gateway.response';

export interface IInventoryCatalogGateway {
  findServicesByIds(ids: readonly string[]): Promise<InventoryServiceGatewayResponse[]>;
  findPartsSuppliesByIds(ids: readonly string[]): Promise<InventoryPartSupplyGatewayResponse[]>;
}
