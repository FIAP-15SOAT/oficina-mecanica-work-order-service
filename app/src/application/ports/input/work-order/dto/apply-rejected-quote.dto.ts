export interface ApplyRejectedQuoteInputDto {
  quoteId: string;
  workOrderId: string;
  reason: string;
  remainingSentCount: number;
  decidedBy: string;
}
