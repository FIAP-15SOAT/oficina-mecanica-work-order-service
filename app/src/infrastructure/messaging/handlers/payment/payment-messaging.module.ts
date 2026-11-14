import { Module } from '@nestjs/common';

import { IStatusHistoryRepository } from '@domain/interfaces/repositories/status-history.repository.interface';
import { IUnitOfWork } from '@domain/interfaces/repositories/unit-of-work.interface';

import { ICache } from '@application/ports/output/services/cache.service.interface';
import { IIdentityUsersGateway } from '@application/ports/output/gateways/identity/identity-users-gateway.interface';
import { IEmailSenderService } from '@application/ports/output/services/email-sender.service.interface';
import { ILogger } from '@application/ports/output/services/logger.service.interface';
import { IMetrics } from '@application/ports/output/services/metrics.service.interface';
import { ApplyPaymentResultUseCase } from '@application/use-cases/payment/apply-payment-result.use-case';
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
        identityUsersGateway: IIdentityUsersGateway,
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
            identityUsersGateway,
          ),
          new ApplyPaymentResultUseCase(
            unitOfWork,
            logger.forContext(ApplyPaymentResultUseCase.name),
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
        'IIdentityUsersGateway',
      ],
    },
  ],
})
export class PaymentMessagingModule {}
