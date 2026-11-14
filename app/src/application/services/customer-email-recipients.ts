import { Customer } from '@domain/entities/customer.entity';
import { ICustomerRepository } from '@domain/interfaces/repositories/customer.repository.interface';
import { IUserCustomerRepository } from '@domain/interfaces/repositories/user-customer.repository.interface';
import { IWorkOrderRepository } from '@domain/interfaces/repositories/work-order.repository.interface';

import { IIdentityUsersGateway } from '@application/ports/output/gateways/identity/identity-users-gateway.interface';
import { IdentityUserGatewayResponse } from '@application/ports/output/gateways/identity/identity-users-gateway.response';

export interface CustomerEmailRecipient {
  email: string;
  name: string;
  hasAccess: boolean;
}

export class CustomerEmailRecipients {
  static fromActiveLinkedUsersOrCustomer(
    customer: Customer,
    linkedUsers: IdentityUserGatewayResponse[],
  ): CustomerEmailRecipient[] {
    const activeLinkedUsers = linkedUsers.filter((user) => user.isActive);

    if (activeLinkedUsers.length === 0) {
      return [{ email: customer.email.value, name: customer.name, hasAccess: false }];
    }

    return activeLinkedUsers.map((user) => ({
      email: user.email,
      name: user.name,
      hasAccess: true,
    }));
  }
}

export class CustomerEmailRecipientsResolver {
  constructor(
    private readonly workOrderRepository: IWorkOrderRepository,
    private readonly customerRepository: ICustomerRepository,
    private readonly userCustomerRepository: IUserCustomerRepository,
    private readonly identityUsersGateway: IIdentityUsersGateway,
  ) {}

  async resolveForWorkOrder(workOrderId: string): Promise<CustomerEmailRecipient[]> {
    const workOrder = (await this.workOrderRepository.findById(workOrderId))!;

    return this.resolveForCustomer(workOrder.customerId);
  }

  async resolveForCustomer(customerId: string): Promise<CustomerEmailRecipient[]> {
    const customer = (await this.customerRepository.findById(customerId))!;
    const linkedUserIds = await this.userCustomerRepository.findUserIdsByCustomerId(customerId);

    const linkedUsers =
      linkedUserIds.length > 0 ? await this.identityUsersGateway.findByIds(linkedUserIds) : [];

    return CustomerEmailRecipients.fromActiveLinkedUsersOrCustomer(customer, linkedUsers);
  }
}
