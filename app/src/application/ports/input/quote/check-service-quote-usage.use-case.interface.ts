export interface ICheckServiceQuoteUsageUseCase {
  execute(serviceId: string): Promise<boolean>;
}
