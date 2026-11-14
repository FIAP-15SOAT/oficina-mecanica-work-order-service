import { randomUUID } from 'node:crypto';

import { GrantCustomerAccessUseCase } from '@application/use-cases/customer-access/grant-customer-access.use-case';
import { IIdentityUsersGateway } from '@application/ports/output/gateways/identity/identity-users-gateway.interface';
import { CustomerAccessUserProvisioner } from '@application/services/customer-access-user-provisioner';
import { ILogger } from '@application/ports/output/services/logger.service.interface';
import { ResourceNotFoundException } from '@application/exceptions/resource-not-found.exception';
import { ResourceConflictException } from '@application/exceptions/resource-conflict.exception';
import { ServiceRequestRejectedException } from '@application/exceptions/service-request-rejected.exception';
import { BUSINESS_EVENTS } from '@application/logging/business-event.catalog';
import { IRepositories, IUnitOfWork } from '@domain/interfaces/repositories/unit-of-work.interface';

import { createMockCustomer } from '../../../../helpers/customer-mock.factory';
import {
  createMockIdentityUserGatewayResponse,
  createMockIdentityUsersGateway,
} from '../../../../helpers/identity-users-gateway-mock.factory';
import { createMockLogger } from '../../../../helpers/logger-mock.factory';
import { createMockUnitOfWorkWithRepos } from '../../../../helpers/unit-of-work-mock.factory';

describe('GrantCustomerAccessUseCase', () => {
  let useCase: GrantCustomerAccessUseCase;
  let unitOfWork: jest.Mocked<IUnitOfWork>;
  let repos: jest.Mocked<IRepositories>;
  let identityUsersGateway: jest.Mocked<IIdentityUsersGateway>;
  let customerAccessUserProvisioner: jest.Mocked<CustomerAccessUserProvisioner>;
  let logger: jest.Mocked<ILogger>;

  beforeEach(() => {
    ({ unitOfWork, repos } = createMockUnitOfWorkWithRepos());

    identityUsersGateway = createMockIdentityUsersGateway();

    customerAccessUserProvisioner = {
      ensureUser: jest.fn(),
    } as unknown as jest.Mocked<CustomerAccessUserProvisioner>;

    logger = createMockLogger();

    useCase = new GrantCustomerAccessUseCase(
      unitOfWork,
      identityUsersGateway,
      customerAccessUserProvisioner,
      logger,
    );
  });

  describe('execute', () => {
    it('should ensure the user in the identity before the transaction that writes the link', async () => {
      const customer = createMockCustomer();
      const user = createMockIdentityUserGatewayResponse({ role: null });

      jest.mocked(repos.customer.findById).mockResolvedValue(customer);
      customerAccessUserProvisioner.ensureUser.mockResolvedValue({
        userId: user.id,
        created: true,
      });
      identityUsersGateway.findById.mockResolvedValue(user);

      await useCase.execute(customer.id, randomUUID());

      expect(customerAccessUserProvisioner.ensureUser).toHaveBeenCalledWith(customer, undefined);
      expect(unitOfWork.executeTransaction).toHaveBeenCalledTimes(2);
      expect(customerAccessUserProvisioner.ensureUser.mock.invocationCallOrder[0]).toBeLessThan(
        unitOfWork.executeTransaction.mock.invocationCallOrder[1],
      );
      expect(identityUsersGateway.findById.mock.invocationCallOrder[0]).toBeLessThan(
        unitOfWork.executeTransaction.mock.invocationCallOrder[1],
      );
    });

    it('should write the link with the user id the identity returns', async () => {
      const customer = createMockCustomer();
      const user = createMockIdentityUserGatewayResponse({ role: null });

      jest.mocked(repos.customer.findById).mockResolvedValue(customer);
      customerAccessUserProvisioner.ensureUser.mockResolvedValue({
        userId: user.id,
        created: true,
      });
      identityUsersGateway.findById.mockResolvedValue(user);

      await useCase.execute(customer.id, randomUUID());

      expect(repos.userCustomer.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: user.id, customerId: customer.id }),
      );
    });

    it.each([
      ['a new user', true],
      ['a user reused by the cpf', false],
    ])(
      'should answer with the user read in the identity and the initial password flag of %s',
      async (_label, created) => {
        const customer = createMockCustomer();
        const actingUserId = randomUUID();
        const user = createMockIdentityUserGatewayResponse({ role: null });

        jest.mocked(repos.customer.findById).mockResolvedValue(customer);
        customerAccessUserProvisioner.ensureUser.mockResolvedValue({ userId: user.id, created });
        identityUsersGateway.findById.mockResolvedValue(user);

        const result = await useCase.execute(customer.id, actingUserId);

        expect(result).toEqual({
          user,
          customer: {
            id: customer.id,
            name: customer.name,
            type: customer.type,
            isActive: true,
          },
          initialPasswordSent: created,
        });
        expect(identityUsersGateway.findById).toHaveBeenCalledWith(user.id);
        expect(logger.event).toHaveBeenCalledWith(BUSINESS_EVENTS.CUSTOMER_ACCESS_GRANTED, {
          subjectId: actingUserId,
          targetUserId: user.id,
          customerId: customer.id,
          accessUserCreated: created,
          initialPasswordSent: created,
        });
      },
    );

    it('should refuse a customer that does not exist without calling the identity', async () => {
      jest.mocked(repos.customer.findById).mockResolvedValue(null);

      await expect(useCase.execute(randomUUID(), randomUUID())).rejects.toThrow(
        ResourceNotFoundException,
      );

      expect(customerAccessUserProvisioner.ensureUser).not.toHaveBeenCalled();
    });

    it.each([
      [409, 'O e-mail informado já pertence a outro usuário. Verifique o cadastro do cliente'],
      [422, 'CPF inválido'],
    ])(
      'should let the %i of the identity through without writing a link',
      async (statusCode, message) => {
        const customer = createMockCustomer();
        const error = new ServiceRequestRejectedException(statusCode, message);

        jest.mocked(repos.customer.findById).mockResolvedValue(customer);
        customerAccessUserProvisioner.ensureUser.mockRejectedValue(error);

        await expect(useCase.execute(customer.id, randomUUID())).rejects.toBe(error);

        expect(repos.userCustomer.create).not.toHaveBeenCalled();
        expect(logger.event).not.toHaveBeenCalled();
      },
    );

    it('should answer 404 without writing a link when the identity does not find the ensured user', async () => {
      const customer = createMockCustomer();
      const userId = randomUUID();

      jest.mocked(repos.customer.findById).mockResolvedValue(customer);
      customerAccessUserProvisioner.ensureUser.mockResolvedValue({ userId, created: true });
      identityUsersGateway.findById.mockResolvedValue(null);

      const result = useCase.execute(customer.id, randomUUID());

      await expect(result).rejects.toThrow(ResourceNotFoundException);
      await expect(result).rejects.toThrow(
        `Usuário não encontrado(a) com identificador: ${userId}`,
      );

      expect(repos.userCustomer.create).not.toHaveBeenCalled();
    });

    it('should let a duplicate link conflict through without auditing the grant', async () => {
      const customer = createMockCustomer();
      const user = createMockIdentityUserGatewayResponse({ role: null });
      const error = new ResourceConflictException('Usuário já possui acesso a este cliente');

      jest.mocked(repos.customer.findById).mockResolvedValue(customer);
      customerAccessUserProvisioner.ensureUser.mockResolvedValue({
        userId: user.id,
        created: false,
      });
      identityUsersGateway.findById.mockResolvedValue(user);
      jest.mocked(repos.userCustomer.create).mockRejectedValue(error);

      await expect(useCase.execute(customer.id, randomUUID())).rejects.toBe(error);

      expect(logger.event).not.toHaveBeenCalled();
    });
  });
});
