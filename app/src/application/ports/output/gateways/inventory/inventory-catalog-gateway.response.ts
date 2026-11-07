export interface InventoryServiceGatewayResponse {
  id: string;
  name: string;
  description: string | null;
  basePrice: number;
}

export interface InventoryPartSupplyGatewayResponse {
  id: string;
  name: string;
  description: string | null;
  sku: string;
  partNumber: string | null;
  category: string;
  unit: string;
  salePrice: number;
}
