import { QuoteStatus } from '@domain/enums/quote-status.enum';

export interface UpdateQuoteStatusDto {
  status: QuoteStatus.APPROVED | QuoteStatus.REJECTED;
  reason?: string | null;
}
