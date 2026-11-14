import { Customer } from '@domain/entities/customer.entity';
import { IUnitOfWork } from '@domain/interfaces/repositories/unit-of-work.interface';

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
    private readonly unitOfWork: IUnitOfWork,
    private readonly identityUsersGateway: IIdentityUsersGateway,
  ) {}

  async resolveForWorkOrder(workOrderId: string): Promise<CustomerEmailRecipient[]> {
    const { customer, linkedUserIds } = await this.unitOfWork.executeTransaction(async (repos) => {
      const workOrder = (await repos.workOrder.findById(workOrderId))!;
      const customer = (await repos.customer.findById(workOrder.customerId))!;
      const linkedUserIds = await repos.userCustomer.findUserIdsByCustomerId(customer.id);

      return { customer, linkedUserIds };
    });

    const linkedUsers =
      linkedUserIds.length > 0 ? await this.identityUsersGateway.findByIds(linkedUserIds) : [];

    return CustomerEmailRecipients.fromActiveLinkedUsersOrCustomer(customer, linkedUsers);
  }
}
