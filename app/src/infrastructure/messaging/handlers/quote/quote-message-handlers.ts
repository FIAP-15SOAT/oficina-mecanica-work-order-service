import { OnModuleInit } from '@nestjs/common';

import { MessageEnvelope } from '@application/messaging/message-envelope';
import { IApplyRejectedQuoteUseCase } from '@application/ports/input/work-order/apply-rejected-quote.use-case.interface';
import { IApplySentQuoteUseCase } from '@application/ports/input/work-order/apply-sent-quote.use-case.interface';

import { InvalidMessageException } from '@infrastructure/exceptions/invalid-message.exception';

import { MessageHandlerRegistry } from '../../message-handler.registry';
import { QuoteRejectedPayloadDto } from './dto/quote-rejected-payload.dto';
import { QuoteSentPayloadDto } from './dto/quote-sent-payload.dto';

// Throwing leaves the message unacknowledged, so it is redelivered and then dead-lettered.
export class QuoteMessageHandlers implements OnModuleInit {
  constructor(
    private readonly registry: MessageHandlerRegistry,
    private readonly applySentQuoteUseCase: IApplySentQuoteUseCase,
    private readonly applyRejectedQuoteUseCase: IApplyRejectedQuoteUseCase,
  ) {}

  onModuleInit(): void {
    this.registry.register(
      'billing.quote.sent',
      (envelope) => this.applySentQuote(envelope),
      QuoteSentPayloadDto,
    );

    this.registry.register(
      'billing.quote.rejected',
      (envelope) => this.applyRejectedQuote(envelope),
      QuoteRejectedPayloadDto,
    );
  }

  private async applySentQuote({
    workOrderId,
    payload,
  }: MessageEnvelope<'billing.quote.sent'>): Promise<void> {
    if (!workOrderId) {
      throw new InvalidMessageException('Mensagem sem a ordem de serviço no envelope');
    }

    await this.applySentQuoteUseCase.execute({ ...payload, workOrderId });
  }

  private async applyRejectedQuote({
    workOrderId,
    payload,
  }: MessageEnvelope<'billing.quote.rejected'>): Promise<void> {
    if (!workOrderId) {
      throw new InvalidMessageException('Mensagem sem a ordem de serviço no envelope');
    }

    await this.applyRejectedQuoteUseCase.execute({ ...payload, workOrderId });
  }
}
