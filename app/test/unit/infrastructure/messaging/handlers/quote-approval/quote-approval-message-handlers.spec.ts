import 'reflect-metadata';
import { randomUUID } from 'node:crypto';

import { MessageEnvelope } from '@application/messaging/message-envelope';
import { ICompleteQuoteApprovalUseCase } from '@application/ports/input/quote-approval/complete-quote-approval.use-case.interface';
import { ICompensateQuoteApprovalUseCase } from '@application/ports/input/quote-approval/compensate-quote-approval.use-case.interface';
import { IConfirmQuoteApprovalReversalUseCase } from '@application/ports/input/quote-approval/confirm-quote-approval-reversal.use-case.interface';
import { IStartQuoteApprovalUseCase } from '@application/ports/input/quote-approval/start-quote-approval.use-case.interface';
import { InvalidMessageException } from '@infrastructure/exceptions/invalid-message.exception';
import { QuoteApprovalMessageHandlers } from '@infrastructure/messaging/handlers/quote-approval/quote-approval-message-handlers';
import { QuoteApprovalRevertedPayloadDto } from '@infrastructure/messaging/handlers/quote-approval/dto/quote-approval-reverted-payload.dto';
import { QuoteApprovedPayloadDto } from '@infrastructure/messaging/handlers/quote-approval/dto/quote-approved-payload.dto';
import { StockReservedPayloadDto } from '@infrastructure/messaging/handlers/quote-approval/dto/stock-reserved-payload.dto';
import { StockReservationFailedPayloadDto } from '@infrastructure/messaging/handlers/quote-approval/dto/stock-reservation-failed-payload.dto';
import { MessageHandlerRegistry } from '@infrastructure/messaging/message-handler.registry';

describe('QuoteApprovalMessageHandlers', () => {
  let handlers: QuoteApprovalMessageHandlers;
  let registry: MessageHandlerRegistry;
  let startQuoteApprovalUseCase: jest.Mocked<IStartQuoteApprovalUseCase>;
  let completeQuoteApprovalUseCase: jest.Mocked<ICompleteQuoteApprovalUseCase>;
  let compensateQuoteApprovalUseCase: jest.Mocked<ICompensateQuoteApprovalUseCase>;
  let confirmQuoteApprovalReversalUseCase: jest.Mocked<IConfirmQuoteApprovalReversalUseCase>;

  beforeEach(() => {
    registry = new MessageHandlerRegistry();

    startQuoteApprovalUseCase = { execute: jest.fn().mockResolvedValue(undefined) };

    completeQuoteApprovalUseCase = { execute: jest.fn().mockResolvedValue(undefined) };

    compensateQuoteApprovalUseCase = { execute: jest.fn().mockResolvedValue(undefined) };

    confirmQuoteApprovalReversalUseCase = { execute: jest.fn().mockResolvedValue(undefined) };

    handlers = new QuoteApprovalMessageHandlers(
      registry,
      startQuoteApprovalUseCase,
      completeQuoteApprovalUseCase,
      compensateQuoteApprovalUseCase,
      confirmQuoteApprovalReversalUseCase,
    );

    handlers.onModuleInit();
  });

  it('should register both billing quote events and both inventory responses with their payload classes', () => {
    expect(registry.find('billing.quote.approved')?.payloadClass).toBe(QuoteApprovedPayloadDto);

    expect(registry.find('billing.quote.approval_reverted')?.payloadClass).toBe(
      QuoteApprovalRevertedPayloadDto,
    );

    expect(registry.find('inventory.stock.reserved')?.payloadClass).toBe(StockReservedPayloadDto);
    expect(registry.find('inventory.stock.reservation_failed')?.payloadClass).toBe(
      StockReservationFailedPayloadDto,
    );
  });

  it('should start the approval with the envelope work order id and the event prices as numbers', async () => {
    const envelope: MessageEnvelope<'billing.quote.approved'> = {
      messageId: randomUUID(),
      type: 'billing.quote.approved',
      occurredAt: new Date().toISOString(),
      workOrderId: randomUUID(),
      payload: {
        quoteId: randomUUID(),
        decidedBy: randomUUID(),
        total: '219.90',
        services: [{ serviceId: randomUUID(), quantity: 1, unitPrice: '129.90' }],
        partsSupplies: [{ partSupplyId: randomUUID(), quantity: 2, unitPrice: '45.00' }],
      },
    };

    await registry.find('billing.quote.approved')?.handler(envelope);

    expect(startQuoteApprovalUseCase.execute).toHaveBeenCalledWith({
      quoteId: envelope.payload.quoteId,
      workOrderId: envelope.workOrderId,
      decidedBy: envelope.payload.decidedBy,
      services: [
        { serviceId: envelope.payload.services[0].serviceId, quantity: 1, unitPrice: 129.9 },
      ],
      partsSupplies: [
        {
          partSupplyId: envelope.payload.partsSupplies[0].partSupplyId,
          quantity: 2,
          unitPrice: 45,
        },
      ],
    });
  });

  it('should reject an approval without the work order in the envelope', async () => {
    const envelope: MessageEnvelope<'billing.quote.approved'> = {
      messageId: randomUUID(),
      type: 'billing.quote.approved',
      occurredAt: new Date().toISOString(),
      workOrderId: null,
      payload: {
        quoteId: randomUUID(),
        decidedBy: randomUUID(),
        total: '129.90',
        services: [{ serviceId: randomUUID(), quantity: 1, unitPrice: '129.90' }],
        partsSupplies: [],
      },
    };

    await expect(registry.find('billing.quote.approved')?.handler(envelope)).rejects.toThrow(
      new InvalidMessageException('Mensagem sem a ordem de serviço no envelope'),
    );

    expect(startQuoteApprovalUseCase.execute).not.toHaveBeenCalled();
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

  it('should confirm the reversal with the quote id', async () => {
    const envelope: MessageEnvelope<'billing.quote.approval_reverted'> = {
      messageId: randomUUID(),
      type: 'billing.quote.approval_reverted',
      occurredAt: new Date().toISOString(),
      workOrderId: randomUUID(),
      payload: { quoteId: randomUUID(), revertTo: 'SENT' },
    };

    await registry.find('billing.quote.approval_reverted')?.handler(envelope);

    expect(confirmQuoteApprovalReversalUseCase.execute).toHaveBeenCalledWith(
      envelope.payload.quoteId,
    );
  });
});
