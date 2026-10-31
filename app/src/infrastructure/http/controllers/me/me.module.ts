import { Module } from '@nestjs/common';

import { InfrastructureServicesModule } from '@infrastructure/services/infrastructure-services.module';

import { ChangeOwnPasswordUseCase } from '@application/use-cases/me/change-own-password.use-case';
import { FindUserByIdUseCase } from '@application/use-cases/user/find-user-by-id.use-case';
import { FindAllMyWorkOrdersUseCase } from '@application/use-cases/me/find-all-my-work-orders.use-case';
import { FindMyWorkOrderByIdUseCase } from '@application/use-cases/me/find-my-work-order-by-id.use-case';
import { FindMyWorkOrdersQuotesUseCase } from '@application/use-cases/me/find-my-work-orders-quotes.use-case';
import { FindMyQuoteByIdUseCase } from '@application/use-cases/me/find-my-quote-by-id.use-case';
import { DecideMyQuoteUseCase } from '@application/use-cases/me/decide-my-quote.use-case';
import { ApproveQuoteUseCase } from '@application/use-cases/quote/approve-quote.use-case';
import { RejectQuoteUseCase } from '@application/use-cases/quote/reject-quote.use-case';
import { UpdateQuoteStatusUseCase } from '@application/use-cases/quote/update-quote-status.use-case';
import { CustomerAccessPolicy } from '@application/policies/customer-access.policy';

import { IUserRepository } from '@domain/interfaces/repositories/user.repository.interface';
import { IUserCustomerRepository } from '@domain/interfaces/repositories/user-customer.repository.interface';
import { IWorkOrderRepository } from '@domain/interfaces/repositories/work-order.repository.interface';
import { IQuoteRepository } from '@domain/interfaces/repositories/quote.repository.interface';
import { IUnitOfWork } from '@domain/interfaces/repositories/unit-of-work.interface';
import { IStatusHistoryRepository } from '@domain/interfaces/repositories/status-history.repository.interface';
import { IHashService } from '@application/ports/output/services/hash.service.interface';
import { ILogger } from '@application/ports/output/services/logger.service.interface';
import { IMetrics } from '@application/ports/output/services/metrics.service.interface';
import { ICache } from '@application/ports/output/services/cache.service.interface';

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
        quoteRepository: IQuoteRepository,
        unitOfWork: IUnitOfWork,
        logger: ILogger,
        metrics: IMetrics,
        statusHistoryRepository: IStatusHistoryRepository,
        cache: ICache,
      ) => {
        const customerAccessPolicy = new CustomerAccessPolicy(
          userCustomerRepository,
          logger.forContext(CustomerAccessPolicy.name),
        );
        const approveQuoteUseCase = new ApproveQuoteUseCase(
          unitOfWork,
          logger.forContext(ApproveQuoteUseCase.name),
          metrics,
          statusHistoryRepository,
          cache,
        );
        const rejectQuoteUseCase = new RejectQuoteUseCase(
          unitOfWork,
          logger.forContext(RejectQuoteUseCase.name),
          metrics,
          statusHistoryRepository,
          cache,
        );
        const updateQuoteStatusUseCase = new UpdateQuoteStatusUseCase(
          approveQuoteUseCase,
          rejectQuoteUseCase,
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
            quoteRepository,
            customerAccessPolicy,
          ),
          new FindMyQuoteByIdUseCase(quoteRepository, workOrderRepository, customerAccessPolicy),
          new DecideMyQuoteUseCase(
            quoteRepository,
            workOrderRepository,
            customerAccessPolicy,
            updateQuoteStatusUseCase,
          ),
        );
      },
      inject: [
        'IUserRepository',
        'IHashService',
        'IUserCustomerRepository',
        'IWorkOrderRepository',
        'IQuoteRepository',
        'IUnitOfWork',
        'ILogger',
        'IMetrics',
        'IStatusHistoryRepository',
        'ICache',
      ],
    },
  ],
})
export class MeModule {}
