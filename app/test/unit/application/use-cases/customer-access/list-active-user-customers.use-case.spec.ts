import { randomUUID } from 'node:crypto';

import { ListActiveUserCustomersUseCase } from '@application/use-cases/customer-access/list-active-user-customers.use-case';
import { CustomerType } from '@domain/enums/customer-type.enum';
import { IUserCustomerRepository } from '@domain/interfaces/repositories/user-customer.repository.interface';

import { createMockCustomer } from '../../../../helpers/customer-mock.factory';
import { createMockUserCustomerRepository } from '../../../../helpers/unit-of-work-mock.factory';

describe('ListActiveUserCustomersUseCase', () => {
  let useCase: ListActiveUserCustomersUseCase;
  let userCustomerRepository: jest.Mocked<IUserCustomerRepository>;

  beforeEach(() => {
    userCustomerRepository = createMockUserCustomerRepository();

    useCase = new ListActiveUserCustomersUseCase(userCustomerRepository);
  });

  it('should list only the active links of active customers', async () => {
    const userId = randomUUID();
    const individual = createMockCustomer();
    const company = createMockCustomer({ type: CustomerType.COMPANY, name: 'Oficina LTDA' });

    userCustomerRepository.findActiveCustomersByUserId.mockResolvedValue([individual, company]);

    const result = await useCase.execute(userId);

    expect(result).toEqual([
      {
        id: individual.id,
        name: individual.name,
        type: CustomerType.INDIVIDUAL,
        document: '12345678909',
        isActive: true,
      },
      {
        id: company.id,
        name: 'Oficina LTDA',
        type: CustomerType.COMPANY,
        document: '12345678000195',
        isActive: true,
      },
    ]);

    expect(userCustomerRepository.findActiveCustomersByUserId).toHaveBeenCalledWith(userId);
  });

  it('should answer an empty list for a user without links', async () => {
    userCustomerRepository.findActiveCustomersByUserId.mockResolvedValue([]);

    const result = await useCase.execute(randomUUID());

    expect(result).toEqual([]);
  });
});
