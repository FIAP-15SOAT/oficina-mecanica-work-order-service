import { randomUUID } from 'node:crypto';

import { CustomerAccessUserProvisioner } from '@application/services/customer-access-user-provisioner';
import { IIdentityUsersGateway } from '@application/ports/output/gateways/identity/identity-users-gateway.interface';
import { CustomerType } from '@domain/enums/customer-type.enum';
import { BusinessRuleViolationException } from '@domain/exceptions/business-rule-violation.exception';
import { Document } from '@domain/value-objects/document.vo';
import { Email } from '@domain/value-objects/email.vo';

import { createMockCustomer } from '../../../helpers/customer-mock.factory';
import { createMockIdentityUsersGateway } from '../../../helpers/identity-users-gateway-mock.factory';

describe('CustomerAccessUserProvisioner', () => {
  let provisioner: CustomerAccessUserProvisioner;
  let identityUsersGateway: jest.Mocked<IIdentityUsersGateway>;

  const companyInput = {
    name: 'Operador',
    email: 'operador@parceira.com.br',
    cpf: '123.456.789-09',
  };

  beforeEach(() => {
    identityUsersGateway = createMockIdentityUsersGateway();
    provisioner = new CustomerAccessUserProvisioner(identityUsersGateway);
  });

  function createCompanyCustomer() {
    return createMockCustomer({
      name: 'Oficina Parceira LTDA',
      type: CustomerType.COMPANY,
      document: Document.create('12345678000195', CustomerType.COMPANY),
      email: Email.create('contato@parceira.com.br'),
    });
  }

  it('should ensure the user of an individual customer by its document', async () => {
    const customer = createMockCustomer();
    const ensured = { userId: randomUUID(), created: true };

    identityUsersGateway.ensureCustomerUser.mockResolvedValue(ensured);

    const result = await provisioner.ensureUser(customer);

    expect(result).toEqual(ensured);
    expect(identityUsersGateway.ensureCustomerUser).toHaveBeenCalledWith({
      name: customer.name,
      email: customer.email.value,
      cpf: customer.document.value,
    });
  });

  it('should send the person data of the body with the cpf in digits only for a company customer', async () => {
    const customer = createCompanyCustomer();

    identityUsersGateway.ensureCustomerUser.mockResolvedValue({
      userId: randomUUID(),
      created: true,
    });

    await provisioner.ensureUser(customer, companyInput);

    expect(identityUsersGateway.ensureCustomerUser).toHaveBeenCalledWith({
      name: 'Operador',
      email: 'operador@parceira.com.br',
      cpf: '12345678909',
    });
  });

  it.each([
    ['no body', undefined],
    ['no email', { name: 'Operador', cpf: '12345678909' }],
    ['no cpf', { name: 'Operador', email: 'operador@parceira.com.br' }],
    ['no name', { email: 'operador@parceira.com.br', cpf: '12345678909' }],
  ])('should require name, email and cpf of a company customer given %s', async (_label, input) => {
    const customer = createCompanyCustomer();

    const result = provisioner.ensureUser(customer, input);

    await expect(result).rejects.toThrow(BusinessRuleViolationException);
    await expect(result).rejects.toThrow(
      'Nome, e-mail e CPF são obrigatórios para conceder acesso a um cliente do tipo COMPANY',
    );

    expect(identityUsersGateway.ensureCustomerUser).not.toHaveBeenCalled();
  });

  it('should refuse an inactive customer without calling the identity', async () => {
    const customer = createMockCustomer({ isActive: false });

    const result = provisioner.ensureUser(customer);

    await expect(result).rejects.toThrow(BusinessRuleViolationException);
    await expect(result).rejects.toThrow('Cliente inativo não pode receber novos acessos');

    expect(identityUsersGateway.ensureCustomerUser).not.toHaveBeenCalled();
  });
});
