import { Module } from '@nestjs/common';

import { ISagaInstanceRepository } from '@domain/interfaces/repositories/saga-instance.repository.interface';
import { IStatusHistoryRepository } from '@domain/interfaces/repositories/status-history.repository.interface';
import { IUnitOfWork } from '@domain/interfaces/repositories/unit-of-work.interface';

import { IBillingQuotesGateway } from '@application/ports/output/gateways/billing/billing-quotes-gateway.interface';
import { ICache } from '@application/ports/output/services/cache.service.interface';
import { IEmailSenderService } from '@application/ports/output/services/email-sender.service.interface';
import { ILogger } from '@application/ports/output/services/logger.service.interface';
import { IMetrics } from '@application/ports/output/services/metrics.service.interface';
import { CompensateQuoteApprovalUseCase } from '@application/use-cases/quote-approval/compensate-quote-approval.use-case';
import { CompleteQuoteApprovalUseCase } from '@application/use-cases/quote-approval/complete-quote-approval.use-case';
import { StartQuoteApprovalUseCase } from '@application/use-cases/quote-approval/start-quote-approval.use-case';

import { InfrastructureServicesModule } from '@infrastructure/services/infrastructure-services.module';

import { MessageHandlerRegistry } from '../../message-handler.registry';
import { QuoteApprovalMessageHandlers } from './quote-approval-message-handlers';

@Module({
  imports: [InfrastructureServicesModule],
  providers: [
    {
      provide: QuoteApprovalMessageHandlers,
      useFactory: (
        registry: MessageHandlerRegistry,
        unitOfWork: IUnitOfWork,
        logger: ILogger,
        metrics: IMetrics,
        statusHistoryRepository: IStatusHistoryRepository,
        cache: ICache,
        emailSender: IEmailSenderService,
        sagaInstanceRepository: ISagaInstanceRepository,
        billingQuotesGateway: IBillingQuotesGateway,
      ) =>
        new QuoteApprovalMessageHandlers(
          registry,
          new StartQuoteApprovalUseCase(
            unitOfWork,
            logger.forContext(StartQuoteApprovalUseCase.name),
            metrics,
            statusHistoryRepository,
            cache,
          ),
          new CompleteQuoteApprovalUseCase(
            sagaInstanceRepository,
            billingQuotesGateway,
            unitOfWork,
            logger.forContext(CompleteQuoteApprovalUseCase.name),
            metrics,
            statusHistoryRepository,
            cache,
          ),
          new CompensateQuoteApprovalUseCase(
            unitOfWork,
            logger.forContext(CompensateQuoteApprovalUseCase.name),
            emailSender,
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
        'ISagaInstanceRepository',
        'IBillingQuotesGateway',
      ],
    },
  ],
})
export class QuoteApprovalMessagingModule {}
