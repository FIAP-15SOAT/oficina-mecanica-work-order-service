import { ApprovedQuoteItems } from '@domain/entities/work-order.entity';

export interface StartQuoteApprovalInputDto extends ApprovedQuoteItems {
  quoteId: string;
  workOrderId: string;
  decidedBy: string;
}
