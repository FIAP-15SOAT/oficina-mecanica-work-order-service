import { Customer } from '@domain/entities/customer.entity';
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
