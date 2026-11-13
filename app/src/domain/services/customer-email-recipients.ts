import { Customer } from '../entities/customer.entity';
import { User } from '../entities/user.entity';

export interface CustomerEmailRecipient {
  email: string;
  name: string;
  hasAccess: boolean;
}

export class CustomerEmailRecipients {
  static fromActiveLinkedUsersOrCustomer(
    customer: Customer,
    linkedUsers: User[],
  ): CustomerEmailRecipient[] {
    const activeLinkedUsers = linkedUsers.filter((user) => user.isActive);

    if (activeLinkedUsers.length === 0) {
      return [{ email: customer.email.value, name: customer.name, hasAccess: false }];
    }

    return activeLinkedUsers.map((user) => ({
      email: user.email.value,
      name: user.name,
      hasAccess: true,
    }));
  }
}
