import { randomUUID } from 'node:crypto';

import { ListCustomerAccessUsersUseCase } from '@application/use-cases/customer-access/list-customer-access-users.use-case';
import { IIdentityUsersGateway } from '@application/ports/output/gateways/identity/identity-users-gateway.interface';
import { ResourceNotFoundException } from '@application/exceptions/resource-not-found.exception';
import { ICustomerRepository } from '@domain/interfaces/repositories/customer.repository.interface';
import { IUserCustomerRepository } from '@domain/interfaces/repositories/user-customer.repository.interface';

import {
  createMockCustomer,
  createMockCustomerRepository,
} from '../../../../helpers/customer-mock.factory';
import {
  createMockIdentityUserGatewayResponse,
  createMockIdentityUsersGateway,
} from '../../../../helpers/identity-users-gateway-mock.factory';
import { createMockUserCustomerRepository } from '../../../../helpers/unit-of-work-mock.factory';

describe('ListCustomerAccessUsersUseCase', () => {
  let useCase: ListCustomerAccessUsersUseCase;
  let customerRepository: jest.Mocked<ICustomerRepository>;
  let userCustomerRepository: jest.Mocked<IUserCustomerRepository>;
  let identityUsersGateway: jest.Mocked<IIdentityUsersGateway>;

  beforeEach(() => {
    customerRepository = createMockCustomerRepository();

    userCustomerRepository = createMockUserCustomerRepository();

    identityUsersGateway = createMockIdentityUsersGateway();

    useCase = new ListCustomerAccessUsersUseCase(
      customerRepository,
      userCustomerRepository,
      identityUsersGateway,
    );
  });

  it('should list the linked users read in the identity', async () => {
    const customer = createMockCustomer();
    const user = createMockIdentityUserGatewayResponse({ role: null });

    customerRepository.findById.mockResolvedValue(customer);
    userCustomerRepository.findUserIdsByCustomerId.mockResolvedValue([user.id]);
    identityUsersGateway.findByIds.mockResolvedValue([user]);

    const result = await useCase.execute(customer.id);

    expect(result).toEqual([user]);
    expect(userCustomerRepository.findUserIdsByCustomerId).toHaveBeenCalledWith(customer.id);
    expect(identityUsersGateway.findByIds).toHaveBeenCalledWith([user.id]);
  });

  it('should leave out a linked user the identity does not find', async () => {
    const customer = createMockCustomer();
    const user = createMockIdentityUserGatewayResponse({ role: null });

    customerRepository.findById.mockResolvedValue(customer);
    userCustomerRepository.findUserIdsByCustomerId.mockResolvedValue([user.id, randomUUID()]);
    identityUsersGateway.findByIds.mockResolvedValue([user]);

    const result = await useCase.execute(customer.id);

    expect(result).toEqual([user]);
  });

  it('should throw when the customer does not exist', async () => {
    customerRepository.findById.mockResolvedValue(null);

    await expect(useCase.execute(randomUUID())).rejects.toThrow(ResourceNotFoundException);

    expect(userCustomerRepository.findUserIdsByCustomerId).not.toHaveBeenCalled();
    expect(identityUsersGateway.findByIds).not.toHaveBeenCalled();
  });
});
