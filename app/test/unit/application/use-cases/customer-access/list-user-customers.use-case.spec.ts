import { randomUUID } from 'node:crypto';

import { ListUserCustomersUseCase } from '@application/use-cases/customer-access/list-user-customers.use-case';
import { IIdentityUsersGateway } from '@application/ports/output/gateways/identity/identity-users-gateway.interface';
import { ResourceNotFoundException } from '@application/exceptions/resource-not-found.exception';
import { Customer } from '@domain/entities/customer.entity';
import { CustomerType } from '@domain/enums/customer-type.enum';
import { IUserCustomerRepository } from '@domain/interfaces/repositories/user-customer.repository.interface';

import {
  createMockIdentityUserGatewayResponse,
  createMockIdentityUsersGateway,
} from '../../../../helpers/identity-users-gateway-mock.factory';
import { createMockUserCustomerRepository } from '../../../../helpers/unit-of-work-mock.factory';

describe('ListUserCustomersUseCase', () => {
  let useCase: ListUserCustomersUseCase;
  let identityUsersGateway: jest.Mocked<IIdentityUsersGateway>;
  let userCustomerRepository: jest.Mocked<IUserCustomerRepository>;

  beforeEach(() => {
    identityUsersGateway = createMockIdentityUsersGateway();

    userCustomerRepository = createMockUserCustomerRepository();

    useCase = new ListUserCustomersUseCase(identityUsersGateway, userCustomerRepository);
  });

  it('should return the customers linked to the user with id, name, type and isActive', async () => {
    const user = createMockIdentityUserGatewayResponse({ role: null });

    const customer = Customer.create({
      name: 'Transportadora XYZ',
      document: '12345678000195',
      type: CustomerType.COMPANY,
      email: 'contato@xyz.com',
      phone: '1133330000',
      address: { street: 'Av C', city: 'São Paulo', state: 'SP', zipCode: '03003000' },
    });

    identityUsersGateway.findById.mockResolvedValue(user);
    userCustomerRepository.findCustomersByUserId.mockResolvedValue([customer]);

    const result = await useCase.execute(user.id);

    expect(result).toEqual([
      { id: customer.id, name: customer.name, type: CustomerType.COMPANY, isActive: true },
    ]);
    expect(identityUsersGateway.findById).toHaveBeenCalledWith(user.id);
  });

  it('should answer 404 without reading the links when the identity does not find the user', async () => {
    const userId = randomUUID();

    identityUsersGateway.findById.mockResolvedValue(null);

    const result = useCase.execute(userId);

    await expect(result).rejects.toThrow(ResourceNotFoundException);
    await expect(result).rejects.toThrow(`Usuário não encontrado(a) com identificador: ${userId}`);

    expect(userCustomerRepository.findCustomersByUserId).not.toHaveBeenCalled();
  });
});
