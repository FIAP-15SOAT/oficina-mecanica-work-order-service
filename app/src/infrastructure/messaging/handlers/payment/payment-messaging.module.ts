import { Module } from '@nestjs/common';

import { ICustomerRepository } from '@domain/interfaces/repositories/customer.repository.interface';
import { ISagaInstanceRepository } from '@domain/interfaces/repositories/saga-instance.repository.interface';
import { IStatusHistoryRepository } from '@domain/interfaces/repositories/status-history.repository.interface';
import { IUnitOfWork } from '@domain/interfaces/repositories/unit-of-work.interface';
import { IUserCustomerRepository } from '@domain/interfaces/repositories/user-customer.repository.interface';
import { IWorkOrderRepository } from '@domain/interfaces/repositories/work-order.repository.interface';

import { ICache } from '@application/ports/output/services/cache.service.interface';
import { IIdentityUsersGateway } from '@application/ports/output/gateways/identity/identity-users-gateway.interface';
import { ILogger } from '@application/ports/output/services/logger.service.interface';
import { IMetrics } from '@application/ports/output/services/metrics.service.interface';
import { CustomerEmailRecipientsResolver } from '@application/services/customer-email-recipients';
import { ApplyPaymentResultUseCase } from '@application/use-cases/payment/apply-payment-result.use-case';
import { StartPaymentUseCase } from '@application/use-cases/payment/start-payment.use-case';

import { MessageHandlerRegistry } from '../../message-handler.registry';
import { PaymentMessageHandlers } from './payment-message-handlers';

@Module({
  providers: [
    {
      provide: PaymentMessageHandlers,
      useFactory: (
        registry: MessageHandlerRegistry,
        unitOfWork: IUnitOfWork,
        logger: ILogger,
        metrics: IMetrics,
        statusHistoryRepository: IStatusHistoryRepository,
        cache: ICache,
        identityUsersGateway: IIdentityUsersGateway,
        workOrderRepository: IWorkOrderRepository,
        sagaInstanceRepository: ISagaInstanceRepository,
        customerRepository: ICustomerRepository,
        userCustomerRepository: IUserCustomerRepository,
      ) =>
        new PaymentMessageHandlers(
          registry,
          new StartPaymentUseCase(
            unitOfWork,
            workOrderRepository,
            sagaInstanceRepository,
            new CustomerEmailRecipientsResolver(
              workOrderRepository,
              customerRepository,
              userCustomerRepository,
              identityUsersGateway,
            ),
            logger.forContext(StartPaymentUseCase.name),
            metrics,
            statusHistoryRepository,
            cache,
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
        'ILogger',
        'IMetrics',
        'IStatusHistoryRepository',
        'ICache',
        'IIdentityUsersGateway',
        'IWorkOrderRepository',
        'ISagaInstanceRepository',
        'ICustomerRepository',
        'IUserCustomerRepository',
      ],
    },
  ],
})
export class PaymentMessagingModule {}
