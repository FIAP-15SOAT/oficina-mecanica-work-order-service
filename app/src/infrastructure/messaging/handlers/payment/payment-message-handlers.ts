import { OnModuleInit } from '@nestjs/common';

import { MessageEnvelope } from '@application/messaging/message-envelope';
import { IApplyPaymentResultUseCase } from '@application/ports/input/payment/apply-payment-result.use-case.interface';
import { IStartPaymentUseCase } from '@application/ports/input/payment/start-payment.use-case.interface';

import { InvalidMessageException } from '@infrastructure/exceptions/invalid-message.exception';

import { MessageHandlerRegistry } from '../../message-handler.registry';
import { PaymentApprovedPayloadDto } from './dto/payment-approved-payload.dto';
import { PaymentFailedPayloadDto } from './dto/payment-failed-payload.dto';
import { PaymentRequestedPayloadDto } from './dto/payment-requested-payload.dto';

export class PaymentMessageHandlers implements OnModuleInit {
  constructor(
    private readonly registry: MessageHandlerRegistry,
    private readonly startPaymentUseCase: IStartPaymentUseCase,
    private readonly applyPaymentResultUseCase: IApplyPaymentResultUseCase,
  ) {}

  onModuleInit(): void {
    this.registry.register(
      'billing.payment.requested',
      (envelope) => this.startPayment(envelope),
      PaymentRequestedPayloadDto,
    );

    this.registry.register(
      'billing.payment.approved',
      ({ payload }) =>
        this.applyPaymentResultUseCase.execute({
          paymentId: payload.paymentId,
          outcome: 'approved',
        }),
      PaymentApprovedPayloadDto,
    );

    this.registry.register(
      'billing.payment.failed',
      ({ payload }) =>
        this.applyPaymentResultUseCase.execute({
          paymentId: payload.paymentId,
          outcome: 'failed',
          reason: payload.reason,
        }),
      PaymentFailedPayloadDto,
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
