import { Module } from '@nestjs/common';

import { InfrastructureServicesModule } from '@infrastructure/services/infrastructure-services.module';

import { ChangeOwnPasswordUseCase } from '@application/use-cases/me/change-own-password.use-case';
import { FindUserByIdUseCase } from '@application/use-cases/user/find-user-by-id.use-case';
import { FindAllMyWorkOrdersUseCase } from '@application/use-cases/me/find-all-my-work-orders.use-case';
import { FindMyWorkOrderByIdUseCase } from '@application/use-cases/me/find-my-work-order-by-id.use-case';
import { FindMyWorkOrdersQuotesUseCase } from '@application/use-cases/me/find-my-work-orders-quotes.use-case';
import { FindMyQuoteByIdUseCase } from '@application/use-cases/me/find-my-quote-by-id.use-case';
import { DecideMyQuoteUseCase } from '@application/use-cases/me/decide-my-quote.use-case';
import { FindMyWorkOrderPaymentsUseCase } from '@application/use-cases/me/find-my-work-order-payments.use-case';
import { CustomerAccessPolicy } from '@application/policies/customer-access.policy';
import { IBillingQuotesGateway } from '@application/ports/output/gateways/billing/billing-quotes-gateway.interface';
import { IBillingPaymentsGateway } from '@application/ports/output/gateways/billing/billing-payments-gateway.interface';

import { IUserRepository } from '@domain/interfaces/repositories/user.repository.interface';
import { IUserCustomerRepository } from '@domain/interfaces/repositories/user-customer.repository.interface';
import { IWorkOrderRepository } from '@domain/interfaces/repositories/work-order.repository.interface';
import { ISagaInstanceRepository } from '@domain/interfaces/repositories/saga-instance.repository.interface';
import { IHashService } from '@application/ports/output/services/hash.service.interface';
import { ILogger } from '@application/ports/output/services/logger.service.interface';

import { MeController as MeCleanController } from '@interface-adapters/me/me.controller';
import { MeController } from './me.controller';

@Module({
  imports: [InfrastructureServicesModule],
  controllers: [MeController],
  providers: [
    {
      provide: MeCleanController,
      useFactory: (
        userRepository: IUserRepository,
        hashService: IHashService,
        userCustomerRepository: IUserCustomerRepository,
        workOrderRepository: IWorkOrderRepository,
        sagaInstanceRepository: ISagaInstanceRepository,
        logger: ILogger,
        billingQuotesGateway: IBillingQuotesGateway,
        billingPaymentsGateway: IBillingPaymentsGateway,
      ) => {
        const customerAccessPolicy = new CustomerAccessPolicy(
          userCustomerRepository,
          logger.forContext(CustomerAccessPolicy.name),
        );

        return new MeCleanController(
          new ChangeOwnPasswordUseCase(
            userRepository,
            hashService,
            logger.forContext(ChangeOwnPasswordUseCase.name),
          ),
          new FindUserByIdUseCase(userRepository, userCustomerRepository),
          new FindAllMyWorkOrdersUseCase(customerAccessPolicy, workOrderRepository),
          new FindMyWorkOrderByIdUseCase(workOrderRepository, customerAccessPolicy),
          new FindMyWorkOrdersQuotesUseCase(
            workOrderRepository,
            billingQuotesGateway,
            customerAccessPolicy,
          ),
          new FindMyQuoteByIdUseCase(
            billingQuotesGateway,
            workOrderRepository,
            customerAccessPolicy,
          ),
          new DecideMyQuoteUseCase(
            billingQuotesGateway,
            workOrderRepository,
            sagaInstanceRepository,
            customerAccessPolicy,
          ),
          new FindMyWorkOrderPaymentsUseCase(
            workOrderRepository,
            billingPaymentsGateway,
            customerAccessPolicy,
          ),
        );
      },
      inject: [
        'IUserRepository',
        'IHashService',
        'IUserCustomerRepository',
        'IWorkOrderRepository',
        'ISagaInstanceRepository',
        'ILogger',
        'IBillingQuotesGateway',
        'IBillingPaymentsGateway',
      ],
    },
  ],
})
export class MeModule {}
