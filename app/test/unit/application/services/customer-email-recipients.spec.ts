import { ICustomerRepository } from '@domain/interfaces/repositories/customer.repository.interface';
import { IUserCustomerRepository } from '@domain/interfaces/repositories/user-customer.repository.interface';
import { IWorkOrderRepository } from '@domain/interfaces/repositories/work-order.repository.interface';

import { IIdentityUsersGateway } from '@application/ports/output/gateways/identity/identity-users-gateway.interface';
import {
  CustomerEmailRecipients,
  CustomerEmailRecipientsResolver,
} from '@application/services/customer-email-recipients';
import { Email } from '@domain/value-objects/email.vo';

import {
  createMockCustomer,
  createMockCustomerRepository,
} from '../../../helpers/customer-mock.factory';
import {
  createMockIdentityUserGatewayResponse,
  createMockIdentityUsersGateway,
} from '../../../helpers/identity-users-gateway-mock.factory';
import { createMockUserCustomerRepository } from '../../../helpers/unit-of-work-mock.factory';
import {
  createMockWorkOrder,
  createMockWorkOrderRepository,
} from '../../../helpers/work-order-mock.factory';

describe('CustomerEmailRecipients', () => {
  const customer = createMockCustomer({
    name: 'Maria Souza',
    email: Email.create('maria@example.com'),
  });

  it('should return the active linked users', () => {
    const recipients = CustomerEmailRecipients.fromActiveLinkedUsersOrCustomer(customer, [
      createMockIdentityUserGatewayResponse({ name: 'João Lima', email: 'joao@example.com' }),
      createMockIdentityUserGatewayResponse({ email: 'inactive@example.com', isActive: false }),
    ]);

    expect(recipients).toEqual([{ email: 'joao@example.com', name: 'João Lima', hasAccess: true }]);
  });

  it('should fall back to the customer e-mail when no linked user is active', () => {
    const recipients = CustomerEmailRecipients.fromActiveLinkedUsersOrCustomer(customer, [
      createMockIdentityUserGatewayResponse({ email: 'inactive@example.com', isActive: false }),
    ]);

    expect(recipients).toEqual([
      { email: 'maria@example.com', name: 'Maria Souza', hasAccess: false },
    ]);
  });
});

describe('CustomerEmailRecipientsResolver', () => {
  let resolver: CustomerEmailRecipientsResolver;
  let workOrderRepository: jest.Mocked<IWorkOrderRepository>;
  let customerRepository: jest.Mocked<ICustomerRepository>;
  let userCustomerRepository: jest.Mocked<IUserCustomerRepository>;
  let identityUsersGateway: jest.Mocked<IIdentityUsersGateway>;

  const customer = createMockCustomer({
    name: 'Maria Souza',
    email: Email.create('maria@example.com'),
  });
  const workOrder = createMockWorkOrder({ customerId: customer.id });

  beforeEach(() => {
    workOrderRepository = createMockWorkOrderRepository();

    customerRepository = createMockCustomerRepository();

    userCustomerRepository = createMockUserCustomerRepository();

    identityUsersGateway = createMockIdentityUsersGateway();

    resolver = new CustomerEmailRecipientsResolver(
      workOrderRepository,
      customerRepository,
      userCustomerRepository,
      identityUsersGateway,
    );

    workOrderRepository.findById.mockResolvedValue(workOrder);
    customerRepository.findById.mockResolvedValue(customer);
  });

  it('should return one recipient with access per active linked user', async () => {
    userCustomerRepository.findUserIdsByCustomerId.mockResolvedValue(['user-1', 'user-2']);

    identityUsersGateway.findByIds.mockResolvedValue([
      createMockIdentityUserGatewayResponse({ name: 'João Lima', email: 'joao@example.com' }),
      createMockIdentityUserGatewayResponse({ name: 'Ana Reis', email: 'ana@example.com' }),
    ]);

    const recipients = await resolver.resolveForWorkOrder(workOrder.id);

    expect(recipients).toEqual([
      { email: 'joao@example.com', name: 'João Lima', hasAccess: true },
      { email: 'ana@example.com', name: 'Ana Reis', hasAccess: true },
    ]);

    expect(workOrderRepository.findById).toHaveBeenCalledWith(workOrder.id);
    expect(customerRepository.findById).toHaveBeenCalledWith(customer.id);
    expect(userCustomerRepository.findUserIdsByCustomerId).toHaveBeenCalledWith(customer.id);
    expect(identityUsersGateway.findByIds).toHaveBeenCalledWith(['user-1', 'user-2']);
  });

  it('should fall back to the customer without calling Identity when there is no link', async () => {
    userCustomerRepository.findUserIdsByCustomerId.mockResolvedValue([]);

    const recipients = await resolver.resolveForWorkOrder(workOrder.id);

    expect(recipients).toEqual([
      { email: 'maria@example.com', name: 'Maria Souza', hasAccess: false },
    ]);

    expect(identityUsersGateway.findByIds).not.toHaveBeenCalled();
  });

  it('should fall back to the customer when every linked user is inactive', async () => {
    userCustomerRepository.findUserIdsByCustomerId.mockResolvedValue(['user-1']);

    identityUsersGateway.findByIds.mockResolvedValue([
      createMockIdentityUserGatewayResponse({ isActive: false }),
    ]);

    const recipients = await resolver.resolveForWorkOrder(workOrder.id);

    expect(recipients).toEqual([
      { email: 'maria@example.com', name: 'Maria Souza', hasAccess: false },
    ]);
  });

  it('should fall back to the customer when Identity returns no user', async () => {
    userCustomerRepository.findUserIdsByCustomerId.mockResolvedValue(['user-1']);
    identityUsersGateway.findByIds.mockResolvedValue([]);

    const recipients = await resolver.resolveForWorkOrder(workOrder.id);

    expect(recipients).toEqual([
      { email: 'maria@example.com', name: 'Maria Souza', hasAccess: false },
    ]);
  });

  it('should let the gateway error propagate', async () => {
    userCustomerRepository.findUserIdsByCustomerId.mockResolvedValue(['user-1']);
    identityUsersGateway.findByIds.mockRejectedValue(new Error('identity down'));

    await expect(resolver.resolveForWorkOrder(workOrder.id)).rejects.toThrow('identity down');
  });

  it('should resolve the recipients of a customer without reading a work order', async () => {
    userCustomerRepository.findUserIdsByCustomerId.mockResolvedValue([]);

    const recipients = await resolver.resolveForCustomer(customer.id);

    expect(recipients).toEqual([
      { email: 'maria@example.com', name: 'Maria Souza', hasAccess: false },
    ]);

    expect(customerRepository.findById).toHaveBeenCalledWith(customer.id);
    expect(workOrderRepository.findById).not.toHaveBeenCalled();
  });
});
