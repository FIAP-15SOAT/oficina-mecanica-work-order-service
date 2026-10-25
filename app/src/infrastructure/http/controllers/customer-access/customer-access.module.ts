import { Module } from '@nestjs/common';

import { InfrastructureServicesModule } from '@infrastructure/services/infrastructure-services.module';

import { GrantCustomerAccessUseCase } from '@application/use-cases/customer-access/grant-customer-access.use-case';
import { ListCustomerAccessUsersUseCase } from '@application/use-cases/customer-access/list-customer-access-users.use-case';
import { ListUserCustomersUseCase } from '@application/use-cases/customer-access/list-user-customers.use-case';
import { RevokeCustomerAccessUseCase } from '@application/use-cases/customer-access/revoke-customer-access.use-case';
import { UpdateCustomerStatusUseCase } from '@application/use-cases/customer-access/update-customer-status.use-case';

import { IUnitOfWork } from '@domain/interfaces/repositories/unit-of-work.interface';
import { IHashService } from '@application/ports/output/hash.service.interface';
import { IEmailSenderService } from '@application/ports/output/email-sender.service.interface';
import { ILogger } from '@application/ports/output/logger.service.interface';
import { ICustomerRepository } from '@domain/interfaces/repositories/customer.repository.interface';
import { IUserRepository } from '@domain/interfaces/repositories/user.repository.interface';
import { IUserCustomerRepository } from '@domain/interfaces/repositories/user-customer.repository.interface';
import { IWorkOrderRepository } from '@domain/interfaces/repositories/work-order.repository.interface';
import { ICache } from '@application/ports/output/cache.service.interface';

import { CustomerAccessController as CustomerAccessCleanController } from '@interface-adapters/customer-access/customer-access.controller';
import { CustomerAccessController } from './customer-access.controller';
import { UserCustomersController } from './user-customers.controller';

@Module({
  imports: [InfrastructureServicesModule],
  controllers: [CustomerAccessController, UserCustomersController],
  providers: [
    {
      provide: CustomerAccessCleanController,
      useFactory: (
        unitOfWork: IUnitOfWork,
        hashService: IHashService,
        emailSender: IEmailSenderService,
        logger: ILogger,
        customerRepository: ICustomerRepository,
        userRepository: IUserRepository,
        userCustomerRepository: IUserCustomerRepository,
        workOrderRepository: IWorkOrderRepository,
        cache: ICache,
      ) =>
        new CustomerAccessCleanController(
          new GrantCustomerAccessUseCase(
            unitOfWork,
            hashService,
            emailSender,
            logger.forContext(GrantCustomerAccessUseCase.name),
          ),
          new ListCustomerAccessUsersUseCase(customerRepository, userCustomerRepository),
          new ListUserCustomersUseCase(userRepository, userCustomerRepository),
          new RevokeCustomerAccessUseCase(
            userCustomerRepository,
            logger.forContext(RevokeCustomerAccessUseCase.name),
          ),
          new UpdateCustomerStatusUseCase(
            customerRepository,
            workOrderRepository,
            cache,
            logger.forContext(UpdateCustomerStatusUseCase.name),
          ),
        ),
      inject: [
        'IUnitOfWork',
        'IHashService',
        'IEmailSenderService',
        'ILogger',
        'ICustomerRepository',
        'IUserRepository',
        'IUserCustomerRepository',
        'IWorkOrderRepository',
        'ICache',
      ],
    },
  ],
  exports: [CustomerAccessCleanController],
})
export class CustomerAccessModule {}
