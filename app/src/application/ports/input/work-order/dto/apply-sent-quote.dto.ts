export interface SentQuoteItemDto {
  name: string;
  quantity: number;
  unitPrice: string;
}

export interface ApplySentQuoteInputDto {
  quoteId: string;
  workOrderId: string;
  sentBy: string;
  total: string;
  items: SentQuoteItemDto[];
}
