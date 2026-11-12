import { Module } from '@nestjs/common';

import { IStatusHistoryRepository } from '@domain/interfaces/repositories/status-history.repository.interface';
import { IUnitOfWork } from '@domain/interfaces/repositories/unit-of-work.interface';

import { ICache } from '@application/ports/output/services/cache.service.interface';
import { IEmailSenderService } from '@application/ports/output/services/email-sender.service.interface';
import { ILogger } from '@application/ports/output/services/logger.service.interface';
import { IMetrics } from '@application/ports/output/services/metrics.service.interface';
import { ApplyRejectedQuoteUseCase } from '@application/use-cases/work-order/apply-rejected-quote.use-case';
import { ApplySentQuoteUseCase } from '@application/use-cases/work-order/apply-sent-quote.use-case';

import { InfrastructureServicesModule } from '@infrastructure/services/infrastructure-services.module';

import { MessageHandlerRegistry } from '../../message-handler.registry';
import { QuoteMessageHandlers } from './quote-message-handlers';

@Module({
  imports: [InfrastructureServicesModule],
  providers: [
    {
      provide: QuoteMessageHandlers,
      useFactory: (
        registry: MessageHandlerRegistry,
        unitOfWork: IUnitOfWork,
        logger: ILogger,
        metrics: IMetrics,
        statusHistoryRepository: IStatusHistoryRepository,
        cache: ICache,
        emailSender: IEmailSenderService,
      ) =>
        new QuoteMessageHandlers(
          registry,
          new ApplySentQuoteUseCase(
            unitOfWork,
            emailSender,
            logger.forContext(ApplySentQuoteUseCase.name),
            metrics,
            statusHistoryRepository,
            cache,
          ),
          new ApplyRejectedQuoteUseCase(
            unitOfWork,
            logger.forContext(ApplyRejectedQuoteUseCase.name),
            metrics,
            statusHistoryRepository,
            cache,
          ),
        ),
      inject: [
        MessageHandlerRegistry,
        'IUnitOfWork',
        'ILogger',
        'IMetrics',
        'IStatusHistoryRepository',
        'ICache',
        'IEmailSenderService',
      ],
    },
  ],
})
export class QuoteMessagingModule {}
