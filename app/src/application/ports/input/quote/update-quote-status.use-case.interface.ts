import { Quote } from '@domain/entities/quote.entity';
import { UpdateQuoteStatusDto } from '@application/ports/input/quote/dto/update-quote-status.dto';

export interface IUpdateQuoteStatusUseCase {
  execute(quoteId: string, userId: string | null, dto: UpdateQuoteStatusDto): Promise<Quote>;
}
