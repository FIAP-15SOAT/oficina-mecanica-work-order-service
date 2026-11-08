import { Quote } from '@domain/entities/quote.entity';
import { QuoteStatus } from '@domain/enums/quote-status.enum';

import { IApproveQuoteUseCase } from '@application/ports/input/quote-approval/approve-quote.use-case.interface';
import { IRejectQuoteUseCase } from '@application/ports/input/quote/reject-quote.use-case.interface';

import { IUpdateQuoteStatusUseCase } from '@application/ports/input/quote/update-quote-status.use-case.interface';
import { UpdateQuoteStatusDto } from '@application/ports/input/quote/dto/update-quote-status.dto';

import { BadRequestException } from '@application/exceptions/bad-request.exception';

export class UpdateQuoteStatusUseCase implements IUpdateQuoteStatusUseCase {
  constructor(
    private readonly approveQuoteUseCase: IApproveQuoteUseCase,
    private readonly rejectQuoteUseCase: IRejectQuoteUseCase,
  ) {}

  async execute(quoteId: string, userId: string | null, dto: UpdateQuoteStatusDto): Promise<Quote> {
    if (dto.status === QuoteStatus.APPROVED) {
      return this.approveQuoteUseCase.execute(quoteId, userId);
    }

    if (!dto.reason) {
      throw new BadRequestException('A justificativa é obrigatória para rejeitar um orçamento.');
    }

    return this.rejectQuoteUseCase.execute(quoteId, dto.reason, userId);
  }
}
