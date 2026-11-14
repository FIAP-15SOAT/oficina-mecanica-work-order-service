import { randomUUID } from 'node:crypto';

import { CustomerAccessPresenter } from '@interface-adapters/customer-access/customer-access.presenter';
import { UserRole } from '@domain/enums/user-role.enum';
import { CustomerType } from '@domain/enums/customer-type.enum';
import {
  AccessUserOutputDto,
  GrantCustomerAccessOutputDto,
} from '@application/ports/input/customer-access/dto/grant-customer-access.dto';
import { LinkedCustomerOutputDto } from '@application/ports/input/customer-access/dto/list-user-customers.dto';

describe('CustomerAccessPresenter', () => {
  describe('toDataResponse', () => {
    it('should wrap the grant result in a data property', () => {
      const result: GrantCustomerAccessOutputDto = {
        user: {
          id: randomUUID(),
          name: 'João da Silva',
          email: 'joao@example.com',
          role: null,
          isActive: true,
        },
        customer: {
          id: randomUUID(),
          name: 'Oficina Parceira LTDA',
          type: CustomerType.COMPANY,
          isActive: true,
        },
        initialPasswordSent: true,
      };

      expect(CustomerAccessPresenter.toDataResponse(result)).toEqual({ data: result });
    });
  });

  describe('toAccessUserListResponse', () => {
    it('should wrap the users in a data property', () => {
      const users: AccessUserOutputDto[] = [
        {
          id: randomUUID(),
          name: 'João da Silva',
          email: 'joao@example.com',
          role: UserRole.ATTENDANT,
          isActive: true,
        },
      ];

      expect(CustomerAccessPresenter.toAccessUserListResponse(users)).toEqual({ data: users });
    });
  });

  describe('toInternalUserCustomerListResponse', () => {
    it('should wrap the customers in a data property', () => {
      const customers = [
        {
          id: randomUUID(),
          name: 'Oficina Parceira LTDA',
          type: CustomerType.COMPANY,
          document: '12345678000195',
          isActive: true,
        },
      ];

      expect(CustomerAccessPresenter.toInternalUserCustomerListResponse(customers)).toEqual({
        data: customers,
      });
    });
  });

  describe('toLinkedCustomerListResponse', () => {
    it('should wrap the customers in a data property', () => {
      const customers: LinkedCustomerOutputDto[] = [
        {
          id: randomUUID(),
          name: 'Oficina Parceira LTDA',
          type: CustomerType.COMPANY,
          isActive: true,
        },
      ];

      expect(CustomerAccessPresenter.toLinkedCustomerListResponse(customers)).toEqual({
        data: customers,
      });
    });
  });
});
