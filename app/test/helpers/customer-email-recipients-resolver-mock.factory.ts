import { CustomerEmailRecipientsResolver } from '@application/services/customer-email-recipients';

export function createMockCustomerEmailRecipientsResolver(): jest.Mocked<CustomerEmailRecipientsResolver> {
  return {
    resolveForCustomer: jest.fn(),
    resolveForWorkOrder: jest.fn(),
  } as unknown as jest.Mocked<CustomerEmailRecipientsResolver>;
}
