import { Module } from '@nestjs/common';

import { CreateCustomerUseCase } from '@application/use-cases/customer/create-customer.use-case';
import { FindAllCustomersUseCase } from '@application/use-cases/customer/find-all-customers.use-case';
import { FindCustomerByIdUseCase } from '@application/use-cases/customer/find-customer-by-id.use-case';
import { UpdateCustomerUseCase } from '@application/use-cases/customer/update-customer.use-case';
import { DeleteCustomerUseCase } from '@application/use-cases/customer/delete-customer.use-case';
import { GrantCustomerAccessUseCase } from '@application/use-cases/customer-access/grant-customer-access.use-case';

import { ICustomerRepository } from '@domain/interfaces/repositories/customer.repository.interface';
import { IUserCustomerRepository } from '@domain/interfaces/repositories/user-customer.repository.interface';
import { IUnitOfWork } from '@domain/interfaces/repositories/unit-of-work.interface';
import { IIdentityUsersGateway } from '@application/ports/output/gateways/identity/identity-users-gateway.interface';
import { ILogger } from '@application/ports/output/services/logger.service.interface';
import { IWorkOrderRepository } from '@domain/interfaces/repositories/work-order.repository.interface';
import { ICache } from '@application/ports/output/services/cache.service.interface';

import { CustomerController as CustomerCleanController } from '@interface-adapters/customer/customer.controller';
import { CustomerController } from './customer.controller';

@Module({
  controllers: [CustomerController],
  providers: [
    {
      provide: CustomerCleanController,
      useFactory: (
        customerRepository: ICustomerRepository,
        userCustomerRepository: IUserCustomerRepository,
        unitOfWork: IUnitOfWork,
        identityUsersGateway: IIdentityUsersGateway,
        logger: ILogger,
        workOrderRepository: IWorkOrderRepository,
        cache: ICache,
      ) =>
        new CustomerCleanController(
          new CreateCustomerUseCase(
            unitOfWork,
            new GrantCustomerAccessUseCase(
              unitOfWork,
              identityUsersGateway,
              logger.forContext(GrantCustomerAccessUseCase.name),
            ),
            logger.forContext(CreateCustomerUseCase.name),
          ),
          new FindAllCustomersUseCase(customerRepository),
          new FindCustomerByIdUseCase(customerRepository),
          new UpdateCustomerUseCase(
            customerRepository,
            userCustomerRepository,
            workOrderRepository,
            cache,
          ),
          new DeleteCustomerUseCase(customerRepository),
        ),
      inject: [
        'ICustomerRepository',
        'IUserCustomerRepository',
        'IUnitOfWork',
        'IIdentityUsersGateway',
        'ILogger',
        'IWorkOrderRepository',
        'ICache',
      ],
    },
  ],
})
export class CustomerModule {}
