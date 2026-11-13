import { CustomerEmailRecipients } from '@domain/services/customer-email-recipients';
import { Email } from '@domain/value-objects/email.vo';

import { createMockCustomer } from '../../../helpers/customer-mock.factory';
import { createMockUser } from '../../../helpers/user-mock.factory';

describe('CustomerEmailRecipients', () => {
  const customer = createMockCustomer({
    name: 'Maria Souza',
    email: Email.create('maria@example.com'),
  });

  it('should return the active linked users', () => {
    const recipients = CustomerEmailRecipients.fromActiveLinkedUsersOrCustomer(customer, [
      createMockUser({ name: 'João Lima', email: Email.create('joao@example.com') }),
      createMockUser({ email: Email.create('inactive@example.com'), isActive: false }),
    ]);

    expect(recipients).toEqual([{ email: 'joao@example.com', name: 'João Lima', hasAccess: true }]);
  });

  it('should fall back to the customer e-mail when no linked user is active', () => {
    const recipients = CustomerEmailRecipients.fromActiveLinkedUsersOrCustomer(customer, [
      createMockUser({ email: Email.create('inactive@example.com'), isActive: false }),
    ]);

    expect(recipients).toEqual([
      { email: 'maria@example.com', name: 'Maria Souza', hasAccess: false },
    ]);
  });
});
