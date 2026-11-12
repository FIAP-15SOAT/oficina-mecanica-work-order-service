export interface IConfirmQuoteApprovalReversalUseCase {
  execute(quoteId: string): Promise<void>;
}
