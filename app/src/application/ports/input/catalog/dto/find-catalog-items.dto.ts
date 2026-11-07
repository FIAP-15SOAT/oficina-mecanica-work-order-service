import {
  InventoryPartSupplyGatewayResponse,
  InventoryServiceGatewayResponse,
} from '@application/ports/output/gateways/inventory/inventory-catalog-gateway.response';

export interface FindCatalogItemsInputDto {
  serviceIds: string[];
  partSupplyIds: string[];
}

export interface FindCatalogItemsOutputDto {
  services: InventoryServiceGatewayResponse[];
  partsSupplies: InventoryPartSupplyGatewayResponse[];
}
