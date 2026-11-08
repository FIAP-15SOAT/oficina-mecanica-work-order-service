import { Quote } from '@domain/entities/quote.entity';

export interface IApproveQuoteUseCase {
  execute(quoteId: string, userId?: string | null): Promise<Quote>;
}
