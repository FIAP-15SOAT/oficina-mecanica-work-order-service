import { Module } from '@nestjs/common';

import { CustomerAccessUserProvisioner } from '@application/services/customer-access-user-provisioner';
import { GrantCustomerAccessUseCase } from '@application/use-cases/customer-access/grant-customer-access.use-case';
import { ListCustomerAccessUsersUseCase } from '@application/use-cases/customer-access/list-customer-access-users.use-case';
import { ListActiveUserCustomersUseCase } from '@application/use-cases/customer-access/list-active-user-customers.use-case';
import { ListUserCustomersUseCase } from '@application/use-cases/customer-access/list-user-customers.use-case';
import { RevokeCustomerAccessUseCase } from '@application/use-cases/customer-access/revoke-customer-access.use-case';
import { UpdateCustomerStatusUseCase } from '@application/use-cases/customer-access/update-customer-status.use-case';

import { IUnitOfWork } from '@domain/interfaces/repositories/unit-of-work.interface';
import { IIdentityUsersGateway } from '@application/ports/output/gateways/identity/identity-users-gateway.interface';
import { ILogger } from '@application/ports/output/services/logger.service.interface';
import { ICustomerRepository } from '@domain/interfaces/repositories/customer.repository.interface';
import { IUserCustomerRepository } from '@domain/interfaces/repositories/user-customer.repository.interface';
import { IWorkOrderRepository } from '@domain/interfaces/repositories/work-order.repository.interface';
import { ICache } from '@application/ports/output/services/cache.service.interface';

import { CustomerAccessController as CustomerAccessCleanController } from '@interface-adapters/customer-access/customer-access.controller';
import { InternalUserCustomersController as InternalUserCustomersCleanController } from '@interface-adapters/customer-access/internal-user-customers.controller';
import { CustomerAccessController } from './customer-access.controller';
import { UserCustomersController } from './user-customers.controller';

@Module({
  controllers: [CustomerAccessController, UserCustomersController],
  providers: [
    {
      provide: CustomerAccessCleanController,
      useFactory: (
        unitOfWork: IUnitOfWork,
        identityUsersGateway: IIdentityUsersGateway,
        logger: ILogger,
        customerRepository: ICustomerRepository,
        userCustomerRepository: IUserCustomerRepository,
        workOrderRepository: IWorkOrderRepository,
        cache: ICache,
      ) =>
        new CustomerAccessCleanController(
          new GrantCustomerAccessUseCase(
            unitOfWork,
            identityUsersGateway,
            new CustomerAccessUserProvisioner(identityUsersGateway),
            logger.forContext(GrantCustomerAccessUseCase.name),
          ),
          new ListCustomerAccessUsersUseCase(
            customerRepository,
            userCustomerRepository,
            identityUsersGateway,
          ),
          new ListUserCustomersUseCase(identityUsersGateway, userCustomerRepository),
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
        'IIdentityUsersGateway',
        'ILogger',
        'ICustomerRepository',
        'IUserCustomerRepository',
        'IWorkOrderRepository',
        'ICache',
      ],
    },
    {
      provide: InternalUserCustomersCleanController,
      useFactory: (userCustomerRepository: IUserCustomerRepository) =>
        new InternalUserCustomersCleanController(
          new ListActiveUserCustomersUseCase(userCustomerRepository),
        ),
      inject: ['IUserCustomerRepository'],
    },
  ],
  exports: [CustomerAccessCleanController, InternalUserCustomersCleanController],
})
export class CustomerAccessModule {}
