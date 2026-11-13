import 'reflect-metadata';
import { randomUUID } from 'node:crypto';

import { MessageEnvelope } from '@application/messaging/message-envelope';
import { IStartPaymentUseCase } from '@application/ports/input/payment/start-payment.use-case.interface';
import { InvalidMessageException } from '@infrastructure/exceptions/invalid-message.exception';
import { PaymentRequestedPayloadDto } from '@infrastructure/messaging/handlers/payment/dto/payment-requested-payload.dto';
import { PaymentMessageHandlers } from '@infrastructure/messaging/handlers/payment/payment-message-handlers';
import { MessageHandlerRegistry } from '@infrastructure/messaging/message-handler.registry';

describe('PaymentMessageHandlers', () => {
  let handlers: PaymentMessageHandlers;
  let registry: MessageHandlerRegistry;
  let startPaymentUseCase: jest.Mocked<IStartPaymentUseCase>;

  beforeEach(() => {
    registry = new MessageHandlerRegistry();

    startPaymentUseCase = { execute: jest.fn().mockResolvedValue(undefined) };

    handlers = new PaymentMessageHandlers(registry, startPaymentUseCase);

    handlers.onModuleInit();
  });

  it('should start the payment from billing.payment.requested', async () => {
    const envelope: MessageEnvelope<'billing.payment.requested'> = {
      messageId: randomUUID(),
      type: 'billing.payment.requested',
      occurredAt: new Date().toISOString(),
      workOrderId: randomUUID(),
      payload: {
        paymentId: randomUUID(),
        amount: '350.00',
        checkoutUrl: 'https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=123',
        expiresAt: '2026-11-15T15:00:00.000Z',
      },
    };

    await registry.find('billing.payment.requested')?.handler(envelope);

    expect(registry.find('billing.payment.requested')?.payloadClass).toBe(
      PaymentRequestedPayloadDto,
    );

    expect(startPaymentUseCase.execute).toHaveBeenCalledWith({
      ...envelope.payload,
      workOrderId: envelope.workOrderId,
    });
  });

  it('should reject a payment request without the work order in the envelope', async () => {
    const envelope: MessageEnvelope<'billing.payment.requested'> = {
      messageId: randomUUID(),
      type: 'billing.payment.requested',
      occurredAt: new Date().toISOString(),
      workOrderId: null,
      payload: {
        paymentId: randomUUID(),
        amount: '350.00',
        checkoutUrl: 'https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=123',
        expiresAt: '2026-11-15T15:00:00.000Z',
      },
    };

    await expect(registry.find('billing.payment.requested')?.handler(envelope)).rejects.toThrow(
      new InvalidMessageException('Mensagem sem a ordem de serviço no envelope'),
    );

    expect(startPaymentUseCase.execute).not.toHaveBeenCalled();
  });
});
