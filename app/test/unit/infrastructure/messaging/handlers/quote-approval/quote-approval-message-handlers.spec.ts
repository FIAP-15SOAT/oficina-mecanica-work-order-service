import 'reflect-metadata';
import { randomUUID } from 'node:crypto';

import { MessageEnvelope } from '@application/messaging/message-envelope';
import { ICompleteQuoteApprovalUseCase } from '@application/ports/input/quote-approval/complete-quote-approval.use-case.interface';
import { ICompensateQuoteApprovalUseCase } from '@application/ports/input/quote-approval/compensate-quote-approval.use-case.interface';
import { QuoteApprovalMessageHandlers } from '@infrastructure/messaging/handlers/quote-approval/quote-approval-message-handlers';
import { StockReservedPayloadDto } from '@infrastructure/messaging/handlers/quote-approval/dto/stock-reserved-payload.dto';
import { StockReservationFailedPayloadDto } from '@infrastructure/messaging/handlers/quote-approval/dto/stock-reservation-failed-payload.dto';
import { MessageHandlerRegistry } from '@infrastructure/messaging/message-handler.registry';

describe('QuoteApprovalMessageHandlers', () => {
  let handlers: QuoteApprovalMessageHandlers;
  let registry: MessageHandlerRegistry;
  let completeQuoteApprovalUseCase: jest.Mocked<ICompleteQuoteApprovalUseCase>;
  let compensateQuoteApprovalUseCase: jest.Mocked<ICompensateQuoteApprovalUseCase>;

  beforeEach(() => {
    registry = new MessageHandlerRegistry();

    completeQuoteApprovalUseCase = { execute: jest.fn().mockResolvedValue(undefined) };

    compensateQuoteApprovalUseCase = { execute: jest.fn().mockResolvedValue(undefined) };

    handlers = new QuoteApprovalMessageHandlers(
      registry,
      completeQuoteApprovalUseCase,
      compensateQuoteApprovalUseCase,
    );

    handlers.onModuleInit();
  });

  it('should register both inventory responses with their payload classes', () => {
    expect(registry.find('inventory.stock.reserved')?.payloadClass).toBe(StockReservedPayloadDto);
    expect(registry.find('inventory.stock.reservation_failed')?.payloadClass).toBe(
      StockReservationFailedPayloadDto,
    );
  });

  it('should complete the approval with the quote id of a reserved message', async () => {
    const envelope: MessageEnvelope<'inventory.stock.reserved'> = {
      messageId: randomUUID(),
      type: 'inventory.stock.reserved',
      occurredAt: new Date().toISOString(),
      workOrderId: randomUUID(),
      payload: { quoteId: randomUUID() },
    };

    await registry.find('inventory.stock.reserved')?.handler(envelope);

    expect(completeQuoteApprovalUseCase.execute).toHaveBeenCalledWith(envelope.payload.quoteId);
  });

  it('should compensate with the quote id and the missing item count of a failure message', async () => {
    const envelope: MessageEnvelope<'inventory.stock.reservation_failed'> = {
      messageId: randomUUID(),
      type: 'inventory.stock.reservation_failed',
      occurredAt: new Date().toISOString(),
      workOrderId: randomUUID(),
      payload: {
        quoteId: randomUUID(),
        missing: [
          { partSupplyId: randomUUID(), requested: 3, available: 1 },
          { partSupplyId: randomUUID(), requested: 2, available: 0 },
        ],
      },
    };

    await registry.find('inventory.stock.reservation_failed')?.handler(envelope);

    expect(compensateQuoteApprovalUseCase.execute).toHaveBeenCalledWith({
      quoteId: envelope.payload.quoteId,
      missingItemCount: 2,
    });
  });
});
