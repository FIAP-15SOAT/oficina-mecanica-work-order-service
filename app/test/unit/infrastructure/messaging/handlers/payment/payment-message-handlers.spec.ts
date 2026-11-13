import 'reflect-metadata';
import { randomUUID } from 'node:crypto';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { MessageEnvelope } from '@application/messaging/message-envelope';
import { IApplyPaymentResultUseCase } from '@application/ports/input/payment/apply-payment-result.use-case.interface';
import { IStartPaymentUseCase } from '@application/ports/input/payment/start-payment.use-case.interface';
import { InvalidMessageException } from '@infrastructure/exceptions/invalid-message.exception';
import { PaymentApprovedPayloadDto } from '@infrastructure/messaging/handlers/payment/dto/payment-approved-payload.dto';
import { PaymentFailedPayloadDto } from '@infrastructure/messaging/handlers/payment/dto/payment-failed-payload.dto';
import { PaymentRequestedPayloadDto } from '@infrastructure/messaging/handlers/payment/dto/payment-requested-payload.dto';
import { PaymentMessageHandlers } from '@infrastructure/messaging/handlers/payment/payment-message-handlers';
import { MessageHandlerRegistry } from '@infrastructure/messaging/message-handler.registry';

describe('PaymentMessageHandlers', () => {
  let handlers: PaymentMessageHandlers;
  let registry: MessageHandlerRegistry;
  let startPaymentUseCase: jest.Mocked<IStartPaymentUseCase>;
  let applyPaymentResultUseCase: jest.Mocked<IApplyPaymentResultUseCase>;

  beforeEach(() => {
    registry = new MessageHandlerRegistry();

    startPaymentUseCase = { execute: jest.fn().mockResolvedValue(undefined) };

    applyPaymentResultUseCase = { execute: jest.fn().mockResolvedValue(undefined) };

    handlers = new PaymentMessageHandlers(registry, startPaymentUseCase, applyPaymentResultUseCase);

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

  it('should apply billing.payment.approved', async () => {
    const envelope: MessageEnvelope<'billing.payment.approved'> = {
      messageId: randomUUID(),
      type: 'billing.payment.approved',
      occurredAt: new Date().toISOString(),
      workOrderId: randomUUID(),
      payload: { paymentId: randomUUID(), amount: '350.00', paidAt: '2026-11-14T15:00:00.000Z' },
    };

    await registry.find('billing.payment.approved')?.handler(envelope);

    expect(registry.find('billing.payment.approved')?.payloadClass).toBe(PaymentApprovedPayloadDto);

    expect(applyPaymentResultUseCase.execute).toHaveBeenCalledWith({
      paymentId: envelope.payload.paymentId,
      outcome: 'approved',
    });
  });

  it('should validate only the payment id of billing.payment.approved', async () => {
    const payload = plainToInstance(PaymentApprovedPayloadDto, {
      paymentId: randomUUID(),
      amount: 350,
      paidAt: 'yesterday',
    });

    const errors = await validate(payload, { forbidUnknownValues: false });

    expect(errors).toEqual([]);
  });

  it('should apply billing.payment.failed with its reason', async () => {
    const envelope: MessageEnvelope<'billing.payment.failed'> = {
      messageId: randomUUID(),
      type: 'billing.payment.failed',
      occurredAt: new Date().toISOString(),
      workOrderId: randomUUID(),
      payload: { paymentId: randomUUID(), reason: 'EXPIRED' },
    };

    await registry.find('billing.payment.failed')?.handler(envelope);

    expect(registry.find('billing.payment.failed')?.payloadClass).toBe(PaymentFailedPayloadDto);

    expect(applyPaymentResultUseCase.execute).toHaveBeenCalledWith({
      paymentId: envelope.payload.paymentId,
      outcome: 'failed',
      reason: 'EXPIRED',
    });
  });
});
