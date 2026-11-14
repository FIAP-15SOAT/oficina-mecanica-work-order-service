import { UserCustomer } from '@domain/entities/user-customer.entity';
import { IUnitOfWork } from '@domain/interfaces/repositories/unit-of-work.interface';

import { IIdentityUsersGateway } from '@application/ports/output/gateways/identity/identity-users-gateway.interface';
import { ILogger } from '@application/ports/output/services/logger.service.interface';
import {
  GrantCustomerAccessDto,
  GrantCustomerAccessOutputDto,
} from '@application/ports/input/customer-access/dto/grant-customer-access.dto';
import { IGrantCustomerAccessUseCase } from '@application/ports/input/customer-access/grant-customer-access.use-case.interface';
import { CustomerAccessUserProvisioner } from '@application/services/customer-access-user-provisioner';
import { ResourceNotFoundException } from '@application/exceptions/resource-not-found.exception';
import { BUSINESS_EVENTS } from '@application/logging/business-event.catalog';

export class GrantCustomerAccessUseCase implements IGrantCustomerAccessUseCase {
  constructor(
    private readonly unitOfWork: IUnitOfWork,
    private readonly identityUsersGateway: IIdentityUsersGateway,
    private readonly customerAccessUserProvisioner: CustomerAccessUserProvisioner,
    private readonly logger: ILogger,
  ) {}

  async execute(
    customerId: string,
    actingUserId: string,
    input?: GrantCustomerAccessDto,
  ): Promise<GrantCustomerAccessOutputDto> {
    const customer = await this.unitOfWork.executeTransaction((repos) =>
      repos.customer.findById(customerId),
    );

    if (!customer) {
      throw new ResourceNotFoundException('Cliente', customerId);
    }

    const { userId, created } = await this.customerAccessUserProvisioner.ensureUser(
      customer,
      input,
    );
    const user = await this.identityUsersGateway.findById(userId);

    if (!user) {
      throw new ResourceNotFoundException('Usuário', userId);
    }

    // If this write fails, a retry reuses the identity user by the CPF.
    await this.unitOfWork.executeTransaction((repos) =>
      repos.userCustomer.create(UserCustomer.create({ userId, customerId })),
    );

    this.logger.event(BUSINESS_EVENTS.CUSTOMER_ACCESS_GRANTED, {
      subjectId: actingUserId,
      targetUserId: userId,
      customerId,
      accessUserCreated: created,
      initialPasswordSent: created,
    });

    return {
      user,
      customer: {
        id: customer.id,
        name: customer.name,
        type: customer.type,
        isActive: customer.isActive,
      },
      initialPasswordSent: created,
    };
  }
}
