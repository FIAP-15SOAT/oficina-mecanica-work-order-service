import { Module } from '@nestjs/common';

import { ICustomerRepository } from '@domain/interfaces/repositories/customer.repository.interface';
import { ISagaInstanceRepository } from '@domain/interfaces/repositories/saga-instance.repository.interface';
import { IStatusHistoryRepository } from '@domain/interfaces/repositories/status-history.repository.interface';
import { IUnitOfWork } from '@domain/interfaces/repositories/unit-of-work.interface';
import { IUserCustomerRepository } from '@domain/interfaces/repositories/user-customer.repository.interface';
import { IWorkOrderRepository } from '@domain/interfaces/repositories/work-order.repository.interface';

import { IBillingQuotesGateway } from '@application/ports/output/gateways/billing/billing-quotes-gateway.interface';
import { ICache } from '@application/ports/output/services/cache.service.interface';
import { IIdentityUsersGateway } from '@application/ports/output/gateways/identity/identity-users-gateway.interface';
import { ILogger } from '@application/ports/output/services/logger.service.interface';
import { IMetrics } from '@application/ports/output/services/metrics.service.interface';
import { CustomerEmailRecipientsResolver } from '@application/services/customer-email-recipients';
import { CompensateQuoteApprovalUseCase } from '@application/use-cases/quote-approval/compensate-quote-approval.use-case';
import { CompleteQuoteApprovalUseCase } from '@application/use-cases/quote-approval/complete-quote-approval.use-case';
import { ConfirmQuoteApprovalReversalUseCase } from '@application/use-cases/quote-approval/confirm-quote-approval-reversal.use-case';
import { StartQuoteApprovalUseCase } from '@application/use-cases/quote-approval/start-quote-approval.use-case';

import { MessageHandlerRegistry } from '../../message-handler.registry';
import { QuoteApprovalMessageHandlers } from './quote-approval-message-handlers';

@Module({
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
        sagaInstanceRepository: ISagaInstanceRepository,
        billingQuotesGateway: IBillingQuotesGateway,
        identityUsersGateway: IIdentityUsersGateway,
        workOrderRepository: IWorkOrderRepository,
        customerRepository: ICustomerRepository,
        userCustomerRepository: IUserCustomerRepository,
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
            metrics,
          ),
          new ConfirmQuoteApprovalReversalUseCase(
            unitOfWork,
            sagaInstanceRepository,
            new CustomerEmailRecipientsResolver(
              workOrderRepository,
              customerRepository,
              userCustomerRepository,
              identityUsersGateway,
            ),
            logger.forContext(ConfirmQuoteApprovalReversalUseCase.name),
            metrics,
          ),
        ),
      inject: [
        MessageHandlerRegistry,
        'IUnitOfWork',
        'ILogger',
        'IMetrics',
        'IStatusHistoryRepository',
        'ICache',
        'ISagaInstanceRepository',
        'IBillingQuotesGateway',
        'IIdentityUsersGateway',
        'IWorkOrderRepository',
        'ICustomerRepository',
        'IUserCustomerRepository',
      ],
    },
  ],
})
export class QuoteApprovalMessagingModule {}
