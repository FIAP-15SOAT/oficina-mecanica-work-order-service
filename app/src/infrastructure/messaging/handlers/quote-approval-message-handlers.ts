import { Inject, Injectable, OnModuleInit } from '@nestjs/common';

import { ICompleteQuoteApprovalUseCase } from '@application/ports/input/quote-approval/complete-quote-approval.use-case.interface';
import { ICompensateQuoteApprovalUseCase } from '@application/ports/input/quote-approval/compensate-quote-approval.use-case.interface';
import { CompleteQuoteApprovalUseCase } from '@application/use-cases/quote-approval/complete-quote-approval.use-case';
import { CompensateQuoteApprovalUseCase } from '@application/use-cases/quote-approval/compensate-quote-approval.use-case';

import { MessageHandlerRegistry } from '../message-handler.registry';
import { StockReservationFailedPayloadDto } from './stock-reservation-failed-payload.dto';
import { StockReservedPayloadDto } from './stock-reserved-payload.dto';

@Injectable()
export class QuoteApprovalMessageHandlers implements OnModuleInit {
  constructor(
    private readonly registry: MessageHandlerRegistry,
    @Inject(CompleteQuoteApprovalUseCase)
    private readonly completeQuoteApprovalUseCase: ICompleteQuoteApprovalUseCase,
    @Inject(CompensateQuoteApprovalUseCase)
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
