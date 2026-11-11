import { OnModuleInit } from '@nestjs/common';

import { MessageEnvelope } from '@application/messaging/message-envelope';
import { ICompleteQuoteApprovalUseCase } from '@application/ports/input/quote-approval/complete-quote-approval.use-case.interface';
import { ICompensateQuoteApprovalUseCase } from '@application/ports/input/quote-approval/compensate-quote-approval.use-case.interface';
import { IStartQuoteApprovalUseCase } from '@application/ports/input/quote-approval/start-quote-approval.use-case.interface';

import { InvalidMessageException } from '@infrastructure/exceptions/invalid-message.exception';

import { MessageHandlerRegistry } from '../../message-handler.registry';
import { QuoteApprovedPayloadDto } from './dto/quote-approved-payload.dto';
import { StockReservationFailedPayloadDto } from './dto/stock-reservation-failed-payload.dto';
import { StockReservedPayloadDto } from './dto/stock-reserved-payload.dto';

export class QuoteApprovalMessageHandlers implements OnModuleInit {
  constructor(
    private readonly registry: MessageHandlerRegistry,
    private readonly startQuoteApprovalUseCase: IStartQuoteApprovalUseCase,
    private readonly completeQuoteApprovalUseCase: ICompleteQuoteApprovalUseCase,
    private readonly compensateQuoteApprovalUseCase: ICompensateQuoteApprovalUseCase,
  ) {}

  onModuleInit(): void {
    this.registry.register(
      'billing.quote.approved',
      (envelope) => this.startQuoteApproval(envelope),
      QuoteApprovedPayloadDto,
    );

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

  private async startQuoteApproval({
    workOrderId,
    payload,
  }: MessageEnvelope<'billing.quote.approved'>): Promise<void> {
    // Throwing leaves the message unacknowledged, so it is redelivered and then dead-lettered.
    if (!workOrderId) {
      throw new InvalidMessageException('Mensagem sem a ordem de serviço no envelope');
    }

    await this.startQuoteApprovalUseCase.execute({
      quoteId: payload.quoteId,
      workOrderId,
      decidedBy: payload.decidedBy,
      services: payload.services.map((item) => ({ ...item, unitPrice: Number(item.unitPrice) })),
      partsSupplies: payload.partsSupplies.map((item) => ({
        ...item,
        unitPrice: Number(item.unitPrice),
      })),
    });
  }
}
