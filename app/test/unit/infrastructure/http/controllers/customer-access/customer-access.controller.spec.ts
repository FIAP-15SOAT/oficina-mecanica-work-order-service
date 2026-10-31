import { randomUUID } from 'node:crypto';

import { CustomerAccessController } from '@infrastructure/http/controllers/customer-access/customer-access.controller';
import { CustomerAccessController as CustomerAccessCleanController } from '@interface-adapters/customer-access/customer-access.controller';
import { CustomerAccessPresenter } from '@interface-adapters/customer-access/customer-access.presenter';

import { CustomerType } from '@domain/enums/customer-type.enum';
import { UserRole } from '@domain/enums/user-role.enum';
import { AuthFlow } from '@domain/enums/auth-flow.enum';

import { AuthenticatedPrincipal } from '@application/auth/authenticated-principal';
import { GrantCustomerAccessRequestDto } from '@infrastructure/http/controllers/customer-access/dto/requests/grant-customer-access-request.dto';
import { UpdateCustomerStatusRequestDto } from '@infrastructure/http/controllers/customer-access/dto/requests/update-customer-status-request.dto';

describe('CustomerAccessController', () => {
  let httpController: CustomerAccessController;
  let cleanController: CustomerAccessCleanController;

  const principal: AuthenticatedPrincipal = {
    sub: randomUUID(),
    authFlow: AuthFlow.INTERNAL,
    email: 'atendente@example.com',
    role: UserRole.ATTENDANT,
  };
  const customerId = randomUUID();

  beforeEach(() => {
    cleanController = new CustomerAccessCleanController(
      { execute: jest.fn() },
      { execute: jest.fn() },
      { execute: jest.fn() },
      { execute: jest.fn() },
      { execute: jest.fn() },
    );
    httpController = new CustomerAccessController(cleanController);
  });

  describe('grantAccess', () => {
    it('should delegate the body and the acting principal to the clean controller', async () => {
      const request: GrantCustomerAccessRequestDto = {
        name: 'Operador',
        email: 'operador@example.com',
        cpf: '12345678909',
      };
      const response = CustomerAccessPresenter.toDataResponse({
        user: {
          id: randomUUID(),
          name: 'Operador',
          email: 'operador@example.com',
          role: null,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        customer: {
          id: customerId,
          name: 'Oficina Parceira LTDA',
          type: CustomerType.COMPANY,
          isActive: true,
        },
        initialPasswordSent: true,
      });
      jest.spyOn(cleanController, 'grantAccess').mockResolvedValue(response);

      const result = await httpController.grantAccess(customerId, request, principal);

      expect(result).toBe(response);
      expect(cleanController.grantAccess).toHaveBeenCalledWith(customerId, principal.sub, request);
    });
  });

  describe('listAccessUsers', () => {
    it('should delegate to the clean controller and return its result', async () => {
      const response = CustomerAccessPresenter.toAccessUserListResponse([
        {
          id: randomUUID(),
          name: 'João da Silva',
          email: 'joao@example.com',
          role: UserRole.ATTENDANT,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);
      jest.spyOn(cleanController, 'listAccessUsers').mockResolvedValue(response);

      const result = await httpController.listAccessUsers(customerId);

      expect(result).toBe(response);
      expect(cleanController.listAccessUsers).toHaveBeenCalledWith(customerId);
    });
  });

  describe('revokeAccess', () => {
    it('should delegate both ids and the acting principal to the clean controller', async () => {
      const userId = randomUUID();
      jest.spyOn(cleanController, 'revokeAccess').mockResolvedValue(undefined);

      await httpController.revokeAccess(customerId, userId, principal);

      expect(cleanController.revokeAccess).toHaveBeenCalledWith(customerId, userId, principal.sub);
    });
  });

  describe('updateStatus', () => {
    it('should unwrap the body flag before delegating to the clean controller', async () => {
      const request: UpdateCustomerStatusRequestDto = { isActive: false };
      jest.spyOn(cleanController, 'updateStatus').mockResolvedValue(undefined);

      await httpController.updateStatus(customerId, request, principal);

      expect(cleanController.updateStatus).toHaveBeenCalledWith(customerId, false, principal.sub);
    });
  });
});
