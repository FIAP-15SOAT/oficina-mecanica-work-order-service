import { Module } from '@nestjs/common';

import { CreateCustomerUseCase } from '@application/use-cases/customer/create-customer.use-case';
import { FindAllCustomersUseCase } from '@application/use-cases/customer/find-all-customers.use-case';
import { FindCustomerByIdUseCase } from '@application/use-cases/customer/find-customer-by-id.use-case';
import { UpdateCustomerUseCase } from '@application/use-cases/customer/update-customer.use-case';
import { DeleteCustomerUseCase } from '@application/use-cases/customer/delete-customer.use-case';
import { GrantCustomerAccessUseCase } from '@application/use-cases/customer-access/grant-customer-access.use-case';
import { InfrastructureServicesModule } from '@infrastructure/services/infrastructure-services.module';

import { ICustomerRepository } from '@domain/interfaces/repositories/customer.repository.interface';
import { IUserCustomerRepository } from '@domain/interfaces/repositories/user-customer.repository.interface';
import { IUnitOfWork } from '@domain/interfaces/repositories/unit-of-work.interface';
import { IHashService } from '@application/ports/output/hash.service.interface';
import { IEmailSenderService } from '@application/ports/output/email-sender.service.interface';
import { ILogger } from '@application/ports/output/logger.service.interface';
import { IWorkOrderRepository } from '@domain/interfaces/repositories/work-order.repository.interface';
import { ICache } from '@application/ports/output/cache.service.interface';

import { CustomerController as CustomerCleanController } from '@interface-adapters/customer/customer.controller';
import { CustomerController } from './customer.controller';

@Module({
  imports: [InfrastructureServicesModule],
  controllers: [CustomerController],
  providers: [
    {
      provide: CustomerCleanController,
      useFactory: (
        customerRepository: ICustomerRepository,
        userCustomerRepository: IUserCustomerRepository,
        unitOfWork: IUnitOfWork,
        hashService: IHashService,
        emailSender: IEmailSenderService,
        logger: ILogger,
        workOrderRepository: IWorkOrderRepository,
        cache: ICache,
      ) =>
        new CustomerCleanController(
          new CreateCustomerUseCase(
            unitOfWork,
            new GrantCustomerAccessUseCase(
              unitOfWork,
              hashService,
              emailSender,
              logger.forContext(GrantCustomerAccessUseCase.name),
            ),
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
        'IHashService',
        'IEmailSenderService',
        'ILogger',
        'IWorkOrderRepository',
        'ICache',
      ],
    },
  ],
})
export class CustomerModule {}
