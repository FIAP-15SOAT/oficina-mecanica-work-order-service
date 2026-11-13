import { Module } from '@nestjs/common';

import { IStatusHistoryRepository } from '@domain/interfaces/repositories/status-history.repository.interface';
import { IUnitOfWork } from '@domain/interfaces/repositories/unit-of-work.interface';

import { ICache } from '@application/ports/output/services/cache.service.interface';
import { IEmailSenderService } from '@application/ports/output/services/email-sender.service.interface';
import { ILogger } from '@application/ports/output/services/logger.service.interface';
import { IMetrics } from '@application/ports/output/services/metrics.service.interface';
import { StartPaymentUseCase } from '@application/use-cases/payment/start-payment.use-case';

import { InfrastructureServicesModule } from '@infrastructure/services/infrastructure-services.module';

import { MessageHandlerRegistry } from '../../message-handler.registry';
import { PaymentMessageHandlers } from './payment-message-handlers';

@Module({
  imports: [InfrastructureServicesModule],
  providers: [
    {
      provide: PaymentMessageHandlers,
      useFactory: (
        registry: MessageHandlerRegistry,
        unitOfWork: IUnitOfWork,
        emailSender: IEmailSenderService,
        logger: ILogger,
        metrics: IMetrics,
        statusHistoryRepository: IStatusHistoryRepository,
        cache: ICache,
      ) =>
        new PaymentMessageHandlers(
          registry,
          new StartPaymentUseCase(
            unitOfWork,
            emailSender,
            logger.forContext(StartPaymentUseCase.name),
            metrics,
            statusHistoryRepository,
            cache,
          ),
        ),
      inject: [
        MessageHandlerRegistry,
        'IUnitOfWork',
        'IEmailSenderService',
        'ILogger',
        'IMetrics',
        'IStatusHistoryRepository',
        'ICache',
      ],
    },
  ],
})
export class PaymentMessagingModule {}
