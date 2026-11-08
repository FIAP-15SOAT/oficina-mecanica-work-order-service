export interface ICheckPartSupplyQuoteUsageUseCase {
  execute(partSupplyId: string): Promise<boolean>;
}
