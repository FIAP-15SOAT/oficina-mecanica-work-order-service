export interface InventoryMessagePayloads {
  'inventory.stock.reserve': {
    quoteId: string;
    items: { partSupplyId: string; quantity: number }[];
  };
  'inventory.stock.consume': Record<string, never>;
  'inventory.stock.reserved': { quoteId: string };
  'inventory.stock.reservation_failed': {
    quoteId: string;
    missing: { partSupplyId: string; requested: number; available: number }[];
  };
}
