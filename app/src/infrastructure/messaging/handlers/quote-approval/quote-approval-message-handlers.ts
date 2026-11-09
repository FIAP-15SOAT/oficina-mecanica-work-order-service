import { OnModuleInit } from '@nestjs/common';

import { ICompleteQuoteApprovalUseCase } from '@application/ports/input/quote-approval/complete-quote-approval.use-case.interface';
import { ICompensateQuoteApprovalUseCase } from '@application/ports/input/quote-approval/compensate-quote-approval.use-case.interface';

import { MessageHandlerRegistry } from '../../message-handler.registry';
import { StockReservationFailedPayloadDto } from './dto/stock-reservation-failed-payload.dto';
import { StockReservedPayloadDto } from './dto/stock-reserved-payload.dto';

export class QuoteApprovalMessageHandlers implements OnModuleInit {
  constructor(
    private readonly registry: MessageHandlerRegistry,
    private readonly completeQuoteApprovalUseCase: ICompleteQuoteApprovalUseCase,
    private readonly compensateQuoteApprovalUseCase: ICompensateQuoteApprovalUseCase,
  ) {}

  onModuleInit(): void {
    this.registry.register(
      'inventory.stock.reserved',
      ({ payload }) => this.completeQuoteApprovalUseCase.execute(payload.quoteId),
      StockReservedPayloadDto,
    );

    this.registry.register(
      'inventory.stock.reservation_failed',
      ({ payload }) =>
        this.compensateQuoteApprovalUseCase.execute({
          quoteId: payload.quoteId,
          missingItemCount: payload.missing.length,
        }),
      StockReservationFailedPayloadDto,
    );
  }
}
