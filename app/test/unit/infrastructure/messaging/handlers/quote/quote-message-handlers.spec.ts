import 'reflect-metadata';
import { randomUUID } from 'node:crypto';

import { MessageEnvelope } from '@application/messaging/message-envelope';
import { IApplyRejectedQuoteUseCase } from '@application/ports/input/work-order/apply-rejected-quote.use-case.interface';
import { IApplySentQuoteUseCase } from '@application/ports/input/work-order/apply-sent-quote.use-case.interface';
import { InvalidMessageException } from '@infrastructure/exceptions/invalid-message.exception';
import { QuoteRejectedPayloadDto } from '@infrastructure/messaging/handlers/quote/dto/quote-rejected-payload.dto';
import { QuoteSentPayloadDto } from '@infrastructure/messaging/handlers/quote/dto/quote-sent-payload.dto';
import { QuoteMessageHandlers } from '@infrastructure/messaging/handlers/quote/quote-message-handlers';
import { MessageHandlerRegistry } from '@infrastructure/messaging/message-handler.registry';

describe('QuoteMessageHandlers', () => {
  let handlers: QuoteMessageHandlers;
  let registry: MessageHandlerRegistry;
  let applySentQuoteUseCase: jest.Mocked<IApplySentQuoteUseCase>;
  let applyRejectedQuoteUseCase: jest.Mocked<IApplyRejectedQuoteUseCase>;

  beforeEach(() => {
    registry = new MessageHandlerRegistry();

    applySentQuoteUseCase = { execute: jest.fn().mockResolvedValue(undefined) };

    applyRejectedQuoteUseCase = { execute: jest.fn().mockResolvedValue(undefined) };

    handlers = new QuoteMessageHandlers(registry, applySentQuoteUseCase, applyRejectedQuoteUseCase);

    handlers.onModuleInit();
  });

  it('should register both quote events with their payload classes', () => {
    expect(registry.find('billing.quote.sent')?.payloadClass).toBe(QuoteSentPayloadDto);
    expect(registry.find('billing.quote.rejected')?.payloadClass).toBe(QuoteRejectedPayloadDto);
  });

  it('should apply a sent quote with the envelope work order id', async () => {
    const envelope: MessageEnvelope<'billing.quote.sent'> = {
      messageId: randomUUID(),
      type: 'billing.quote.sent',
      occurredAt: new Date().toISOString(),
      workOrderId: randomUUID(),
      payload: {
        quoteId: randomUUID(),
        sentBy: randomUUID(),
        total: '150.00',
        items: [{ name: 'Troca de óleo', quantity: 1, unitPrice: '150.00' }],
      },
    };

    await registry.find('billing.quote.sent')?.handler(envelope);

    expect(applySentQuoteUseCase.execute).toHaveBeenCalledWith({
      ...envelope.payload,
      workOrderId: envelope.workOrderId,
    });
  });

  it('should apply a rejected quote with the envelope work order id', async () => {
    const envelope: MessageEnvelope<'billing.quote.rejected'> = {
      messageId: randomUUID(),
      type: 'billing.quote.rejected',
      occurredAt: new Date().toISOString(),
      workOrderId: randomUUID(),
      payload: {
        quoteId: randomUUID(),
        reason: 'Valor acima do esperado',
        remainingSentCount: 0,
        decidedBy: randomUUID(),
      },
    };

    await registry.find('billing.quote.rejected')?.handler(envelope);

    expect(applyRejectedQuoteUseCase.execute).toHaveBeenCalledWith({
      ...envelope.payload,
      workOrderId: envelope.workOrderId,
    });
  });

  it.each(['billing.quote.sent', 'billing.quote.rejected'])(
    'should refuse a %s event without work order id',
    async (type) => {
      const envelope = {
        messageId: randomUUID(),
        type,
        occurredAt: new Date().toISOString(),
        workOrderId: null,
        payload: { quoteId: randomUUID() },
      } as MessageEnvelope;

      await expect(registry.find(type)?.handler(envelope)).rejects.toThrow(
        new InvalidMessageException('Mensagem sem a ordem de serviço no envelope'),
      );

      expect(applySentQuoteUseCase.execute).not.toHaveBeenCalled();
      expect(applyRejectedQuoteUseCase.execute).not.toHaveBeenCalled();
    },
  );
});
