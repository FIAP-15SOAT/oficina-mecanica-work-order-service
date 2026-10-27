/** Type of stock movement */
export enum StockMovementType {
  /** Parts and supplies entering stock */
  ENTRY = 'ENTRY',
  /** Exit by consumption in a work order */
  EXIT = 'EXIT',
  /** Stock adjustment (inventory count) */
  ADJUSTMENT = 'ADJUSTMENT',
}
