export interface ICompleteQuoteApprovalUseCase {
  execute(quoteId: string): Promise<void>;
}
