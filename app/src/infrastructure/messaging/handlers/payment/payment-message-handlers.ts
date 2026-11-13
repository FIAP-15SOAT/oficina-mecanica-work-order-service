import { OnModuleInit } from '@nestjs/common';

import { MessageEnvelope } from '@application/messaging/message-envelope';
import { IStartPaymentUseCase } from '@application/ports/input/payment/start-payment.use-case.interface';

import { InvalidMessageException } from '@infrastructure/exceptions/invalid-message.exception';

import { MessageHandlerRegistry } from '../../message-handler.registry';
import { PaymentRequestedPayloadDto } from './dto/payment-requested-payload.dto';

export class PaymentMessageHandlers implements OnModuleInit {
  constructor(
    private readonly registry: MessageHandlerRegistry,
    private readonly startPaymentUseCase: IStartPaymentUseCase,
  ) {}

  onModuleInit(): void {
    this.registry.register(
      'billing.payment.requested',
      (envelope) => this.startPayment(envelope),
      PaymentRequestedPayloadDto,
    );
  }

  private async startPayment({
    workOrderId,
    payload,
  }: MessageEnvelope<'billing.payment.requested'>): Promise<void> {
    // Throwing leaves the message unacknowledged, so it is redelivered and then dead-lettered.
    if (!workOrderId) {
      throw new InvalidMessageException('Mensagem sem a ordem de serviço no envelope');
    }

    await this.startPaymentUseCase.execute({ ...payload, workOrderId });
  }
}
