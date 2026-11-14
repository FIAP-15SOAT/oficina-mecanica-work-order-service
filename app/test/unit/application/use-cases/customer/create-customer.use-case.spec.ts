import { randomUUID } from 'node:crypto';
import { CreateCustomerUseCase } from '@application/use-cases/customer/create-customer.use-case';
import { GrantCustomerAccessUseCase } from '@application/use-cases/customer-access/grant-customer-access.use-case';
import { ILogger } from '@application/ports/output/services/logger.service.interface';
import { ResourceConflictException } from '@application/exceptions/resource-conflict.exception';
import { ServiceRequestRejectedException } from '@application/exceptions/service-request-rejected.exception';
import { BUSINESS_EVENTS } from '@application/logging/business-event.catalog';
import { BusinessRuleViolationException } from '@domain/exceptions/business-rule-violation.exception';
import { CustomerType } from '@domain/enums/customer-type.enum';
import { IUnitOfWork, IRepositories } from '@domain/interfaces/repositories/unit-of-work.interface';
import { Customer } from '@domain/entities/customer.entity';
import { Document } from '@domain/value-objects/document.vo';
import { Email } from '@domain/value-objects/email.vo';
import { Phone } from '@domain/value-objects/phone.vo';
import { createMockUnitOfWorkWithRepos } from '../../../../helpers/unit-of-work-mock.factory';
import { createMockCustomer } from '../../../../helpers/customer-mock.factory';
import { createMockLogger } from '../../../../helpers/logger-mock.factory';

describe('CreateCustomerUseCase', () => {
  let useCase: CreateCustomerUseCase;
  let unitOfWork: jest.Mocked<IUnitOfWork>;
  let repos: jest.Mocked<IRepositories>;
  let grantCustomerAccessUseCase: jest.Mocked<Pick<GrantCustomerAccessUseCase, 'ensureUser'>>;
  let logger: jest.Mocked<ILogger>;

  const validInput = {
    name: 'João da Silva',
    document: '123.456.789-09',
    type: CustomerType.INDIVIDUAL,
    email: 'joao@email.com',
    phone: '11999999999',
    address: { street: 'Rua das Flores, 123', city: 'São Paulo', state: 'SP', zipCode: '01310100' },
  };

  beforeEach(() => {
    ({ unitOfWork, repos } = createMockUnitOfWorkWithRepos());

    grantCustomerAccessUseCase = { ensureUser: jest.fn() };

    logger = createMockLogger();

    useCase = new CreateCustomerUseCase(
      unitOfWork,
      grantCustomerAccessUseCase as unknown as GrantCustomerAccessUseCase,
      logger,
    );
  });

  it('should create customer when document and email are unique', async () => {
    const sanitizedDocument = '12345678909';

    const saved = createMockCustomer({
      name: validInput.name,
      document: Document.create(sanitizedDocument, validInput.type),
      type: validInput.type,
      email: Email.create(validInput.email),
      phone: Phone.create(validInput.phone),
    });

    jest.mocked(repos.customer.findByDocument).mockResolvedValue(null);
    jest.mocked(repos.customer.findByEmail).mockResolvedValue(null);
    jest.mocked(repos.customer.create).mockResolvedValue(saved);

    const result = await useCase.execute({ ...validInput, createAccess: false }, randomUUID());

    expect(result).toEqual(saved);
    expect(repos.customer.findByDocument).toHaveBeenCalledWith(sanitizedDocument);
    expect(repos.customer.create).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['document', { findByDocument: createMockCustomer(), findByEmail: null }],
    ['email', { findByDocument: null, findByEmail: createMockCustomer() }],
  ])(
    'should answer 409 without calling the identity when the %s already exists',
    async (_label, found) => {
      jest.mocked(repos.customer.findByDocument).mockResolvedValue(found.findByDocument);
      jest.mocked(repos.customer.findByEmail).mockResolvedValue(found.findByEmail);

      await expect(useCase.execute(validInput, randomUUID())).rejects.toThrow(
        ResourceConflictException,
      );

      expect(grantCustomerAccessUseCase.ensureUser).not.toHaveBeenCalled();
      expect(repos.customer.create).not.toHaveBeenCalled();
    },
  );

  it('should ensure the access user outside the transaction that writes the customer and the link', async () => {
    const actingUserId = randomUUID();
    const userId = randomUUID();

    jest.mocked(repos.customer.findByDocument).mockResolvedValue(null);
    jest.mocked(repos.customer.findByEmail).mockResolvedValue(null);
    jest
      .mocked(repos.customer.create)
      .mockImplementation((customer: Customer) => Promise.resolve(customer));
    grantCustomerAccessUseCase.ensureUser.mockResolvedValue({ userId, created: true });

    const created = await useCase.execute(validInput, actingUserId);

    expect(grantCustomerAccessUseCase.ensureUser).toHaveBeenCalledWith(created);
    expect(unitOfWork.executeTransaction).toHaveBeenCalledTimes(2);
    expect(grantCustomerAccessUseCase.ensureUser.mock.invocationCallOrder[0]).toBeLessThan(
      unitOfWork.executeTransaction.mock.invocationCallOrder[1],
    );
    expect(repos.userCustomer.create).toHaveBeenCalledWith(
      expect.objectContaining({ userId, customerId: created.id }),
    );
    expect(logger.event).toHaveBeenCalledWith(BUSINESS_EVENTS.CUSTOMER_ACCESS_GRANTED, {
      subjectId: actingUserId,
      targetUserId: userId,
      customerId: created.id,
      accessUserCreated: true,
      initialPasswordSent: true,
    });
  });

  it('should skip the access user when createAccess is false', async () => {
    jest.mocked(repos.customer.findByDocument).mockResolvedValue(null);
    jest.mocked(repos.customer.findByEmail).mockResolvedValue(null);
    jest
      .mocked(repos.customer.create)
      .mockImplementation((customer: Customer) => Promise.resolve(customer));

    await useCase.execute({ ...validInput, createAccess: false }, randomUUID());

    expect(grantCustomerAccessUseCase.ensureUser).not.toHaveBeenCalled();
    expect(repos.userCustomer.create).not.toHaveBeenCalled();
    expect(logger.event).not.toHaveBeenCalled();
  });

  it('should reject createAccess true combined with COMPANY', async () => {
    await expect(
      useCase.execute(
        {
          name: 'Oficina Parceira LTDA',
          document: '12345678000195',
          type: CustomerType.COMPANY,
          email: 'contato@parceira.com.br',
          phone: '1133330000',
          address: { street: 'Av B', city: 'SP', state: 'SP', zipCode: '02002000' },
          createAccess: true,
        },
        randomUUID(),
      ),
    ).rejects.toThrow(BusinessRuleViolationException);

    expect(unitOfWork.executeTransaction).not.toHaveBeenCalled();
  });

  it('should let a refusal of the identity through without writing the customer', async () => {
    const error = new ServiceRequestRejectedException(
      409,
      'O e-mail informado já pertence a outro usuário. Verifique o cadastro do cliente',
    );

    jest.mocked(repos.customer.findByDocument).mockResolvedValue(null);
    jest.mocked(repos.customer.findByEmail).mockResolvedValue(null);
    grantCustomerAccessUseCase.ensureUser.mockRejectedValue(error);

    await expect(useCase.execute(validInput, randomUUID())).rejects.toBe(error);

    expect(repos.customer.create).not.toHaveBeenCalled();
    expect(repos.userCustomer.create).not.toHaveBeenCalled();
  });
});
