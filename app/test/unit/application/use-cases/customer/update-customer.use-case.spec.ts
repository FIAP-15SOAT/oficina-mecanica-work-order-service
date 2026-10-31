import { UpdateCustomerUseCase } from '@application/use-cases/customer/update-customer.use-case';
import { ResourceNotFoundException } from '@application/exceptions/resource-not-found.exception';
import { ResourceConflictException } from '@application/exceptions/resource-conflict.exception';
import { BusinessRuleViolationException } from '@domain/exceptions/business-rule-violation.exception';
import { CustomerType } from '@domain/enums/customer-type.enum';
import { ICustomerRepository } from '@domain/interfaces/repositories/customer.repository.interface';
import { IUserCustomerRepository } from '@domain/interfaces/repositories/user-customer.repository.interface';
import { UpdateCustomerDto } from '@application/ports/input/customer/dto/update-customer.dto';
import {
  createMockCustomer,
  createMockCustomerRepository,
} from '../../../../helpers/customer-mock.factory';
import { createMockUser } from '../../../../helpers/user-mock.factory';
import { Document } from '@domain/value-objects/document.vo';
import { Email } from '@domain/value-objects/email.vo';
import { ICache } from '@application/ports/output/services/cache.service.interface';
import { workOrderCacheKey } from '@application/keys/work-order-cache-key';
import { createMockCache } from '../../../../helpers/cache-mock.factory';
import { IWorkOrderRepository } from '@domain/interfaces/repositories/work-order.repository.interface';
import {
  createMockWorkOrder,
  createMockWorkOrderRepository,
} from '../../../../helpers/work-order-mock.factory';

describe('UpdateCustomerUseCase', () => {
  let cache: jest.Mocked<ICache>;
  let workOrderRepository: jest.Mocked<IWorkOrderRepository>;
  let useCase: UpdateCustomerUseCase;
  let customerRepository: jest.Mocked<ICustomerRepository>;
  let userCustomerRepository: jest.Mocked<IUserCustomerRepository>;

  const validInput: UpdateCustomerDto = {
    name: 'João da Silva',
    document: '123.456.789-09',
    type: CustomerType.INDIVIDUAL,
    email: 'joao@email.com',
    phone: '11999999999',
    address: { street: 'Rua das Flores, 123', city: 'São Paulo', state: 'SP', zipCode: '01310100' },
  };

  beforeEach(() => {
    customerRepository = createMockCustomerRepository();
    userCustomerRepository = { findUsersByCustomerId: jest.fn().mockResolvedValue([]) } as never;
    cache = createMockCache();
    workOrderRepository = createMockWorkOrderRepository();
    useCase = new UpdateCustomerUseCase(
      customerRepository,
      userCustomerRepository,
      workOrderRepository,
      cache,
    );
  });

  it('should update customer successfully', async () => {
    const existing = createMockCustomer({ id: 'cust-1' });
    const updated = createMockCustomer({ id: 'cust-1', name: 'João Atualizado' });
    customerRepository.findById.mockResolvedValue(existing);
    customerRepository.update.mockResolvedValue(updated);

    const result = await useCase.execute('cust-1', { ...validInput, name: 'João Atualizado' });

    expect(result).toEqual(updated);
    expect(customerRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'João Atualizado' }),
    );
  });

  it('should throw ResourceNotFoundException when customer not found', async () => {
    customerRepository.findById.mockResolvedValue(null);

    await expect(useCase.execute('non-existent', validInput)).rejects.toThrow(
      ResourceNotFoundException,
    );
    expect(customerRepository.update).not.toHaveBeenCalled();
  });

  it('should throw ResourceConflictException when new document belongs to another customer', async () => {
    const existing = createMockCustomer({
      id: 'cust-1',
      document: Document.create('11144477735', CustomerType.INDIVIDUAL),
    });
    const other = createMockCustomer({
      id: 'cust-2',
      document: Document.create('123.456.789-09', CustomerType.INDIVIDUAL),
    });
    customerRepository.findById.mockResolvedValue(existing);
    customerRepository.findByDocument.mockResolvedValue(other);

    await expect(
      useCase.execute('cust-1', { ...validInput, document: '123.456.789-09' }),
    ).rejects.toThrow(ResourceConflictException);
    expect(customerRepository.update).not.toHaveBeenCalled();
  });

  it('should throw ResourceConflictException when new email belongs to another customer', async () => {
    const existing = createMockCustomer({ id: 'cust-1', email: Email.create('old@email.com') });
    const other = createMockCustomer({ id: 'cust-2', email: Email.create('taken@email.com') });
    customerRepository.findById.mockResolvedValue(existing);
    customerRepository.findByEmail.mockResolvedValue(other);

    await expect(
      useCase.execute('cust-1', { ...validInput, email: 'taken@email.com' }),
    ).rejects.toThrow(ResourceConflictException);
    expect(customerRepository.update).not.toHaveBeenCalled();
  });

  it('should not check uniqueness when document/email are unchanged', async () => {
    const existing = createMockCustomer({
      id: 'cust-1',
      document: Document.create('12345678909', CustomerType.INDIVIDUAL),
      email: Email.create(validInput.email),
    });
    customerRepository.findById.mockResolvedValue(existing);
    customerRepository.update.mockResolvedValue(existing);

    await useCase.execute('cust-1', { ...validInput, document: '12345678909' });

    expect(customerRepository.findByDocument).not.toHaveBeenCalled();
    expect(customerRepository.findByEmail).not.toHaveBeenCalled();
  });

  it('should update when document and email change without conflicts', async () => {
    const existing = createMockCustomer({
      id: 'cust-1',
      document: Document.create('11144477735', CustomerType.INDIVIDUAL),
      email: Email.create('old@email.com'),
    });
    const updated = createMockCustomer({
      id: 'cust-1',
      document: Document.create('12345678909', CustomerType.INDIVIDUAL),
      email: Email.create(validInput.email),
    });
    customerRepository.findById.mockResolvedValue(existing);
    customerRepository.findByDocument.mockResolvedValue(null);
    customerRepository.findByEmail.mockResolvedValue(null);
    customerRepository.update.mockResolvedValue(updated);

    const result = await useCase.execute('cust-1', validInput);

    expect(result).toEqual(updated);
    expect(customerRepository.findByDocument).toHaveBeenCalledWith('12345678909');
    expect(customerRepository.findByEmail).toHaveBeenCalledWith(validInput.email);
    expect(customerRepository.update).toHaveBeenCalled();
  });

  it('should reject changing the document when the customer has active access links', async () => {
    const existing = createMockCustomer({
      id: 'cust-1',
      document: Document.create('11144477735', CustomerType.INDIVIDUAL),
    });
    customerRepository.findById.mockResolvedValue(existing);
    customerRepository.findByDocument.mockResolvedValue(null);
    userCustomerRepository.findUsersByCustomerId.mockResolvedValue([
      createMockUser({ id: 'user-1' }),
    ]);

    await expect(
      useCase.execute('cust-1', { ...validInput, document: '123.456.789-09' }),
    ).rejects.toThrow(BusinessRuleViolationException);
    expect(customerRepository.update).not.toHaveBeenCalled();
  });

  it('should reject changing the type when the customer has active access links', async () => {
    const existing = createMockCustomer({ id: 'cust-1', type: CustomerType.INDIVIDUAL });
    customerRepository.findById.mockResolvedValue(existing);
    userCustomerRepository.findUsersByCustomerId.mockResolvedValue([
      createMockUser({ id: 'user-1' }),
    ]);

    await expect(
      useCase.execute('cust-1', {
        ...validInput,
        type: CustomerType.COMPANY,
        document: '12345678000195',
      }),
    ).rejects.toThrow(BusinessRuleViolationException);
    expect(customerRepository.update).not.toHaveBeenCalled();
  });

  it('should allow a COMPANY customer to correct its own CNPJ even with active access links', async () => {
    const existing = createMockCustomer({
      id: 'cust-1',
      type: CustomerType.COMPANY,
      document: Document.create('11.222.333/0001-81', CustomerType.COMPANY),
    });
    const updated = createMockCustomer({ id: 'cust-1', type: CustomerType.COMPANY });
    customerRepository.findById.mockResolvedValue(existing);
    customerRepository.findByDocument.mockResolvedValue(null);
    customerRepository.update.mockResolvedValue(updated);
    userCustomerRepository.findUsersByCustomerId.mockResolvedValue([
      createMockUser({ id: 'user-1' }),
    ]);

    const result = await useCase.execute('cust-1', {
      ...validInput,
      type: CustomerType.COMPANY,
      document: '12.345.678/0001-95',
    });

    expect(result).toEqual(updated);
    expect(userCustomerRepository.findUsersByCustomerId).not.toHaveBeenCalled();
  });

  it('should allow updating other fields when the customer has active access links', async () => {
    const existing = createMockCustomer({ id: 'cust-1' });
    const updated = createMockCustomer({ id: 'cust-1', name: 'Novo Nome' });
    customerRepository.findById.mockResolvedValue(existing);
    customerRepository.update.mockResolvedValue(updated);
    userCustomerRepository.findUsersByCustomerId.mockResolvedValue([
      createMockUser({ id: 'user-1' }),
    ]);

    const result = await useCase.execute('cust-1', { ...validInput, name: 'Novo Nome' });

    expect(result).toEqual(updated);
  });

  it('should reject changing the document when the customer has linked work orders', async () => {
    const existing = createMockCustomer({
      id: 'cust-1',
      document: Document.create('11144477735', CustomerType.INDIVIDUAL),
    });
    customerRepository.findById.mockResolvedValue(existing);
    customerRepository.findByDocument.mockResolvedValue(null);
    customerRepository.hasWorkOrders.mockResolvedValue(true);

    await expect(
      useCase.execute('cust-1', { ...validInput, document: '123.456.789-09' }),
    ).rejects.toThrow(BusinessRuleViolationException);
    expect(customerRepository.update).not.toHaveBeenCalled();
  });

  it('should allow changing the document when the customer only has linked vehicles', async () => {
    const existing = createMockCustomer({
      id: 'cust-1',
      document: Document.create('11144477735', CustomerType.INDIVIDUAL),
    });
    const updated = createMockCustomer({ id: 'cust-1' });
    customerRepository.findById.mockResolvedValue(existing);
    customerRepository.findByDocument.mockResolvedValue(null);
    customerRepository.update.mockResolvedValue(updated);
    customerRepository.hasWorkOrders.mockResolvedValue(false);

    const result = await useCase.execute('cust-1', {
      ...validInput,
      document: '123.456.789-09',
    });

    expect(result).toEqual(updated);
  });

  it('should allow a COMPANY customer to correct its own CNPJ even with linked work orders', async () => {
    const existing = createMockCustomer({
      id: 'cust-1',
      type: CustomerType.COMPANY,
      document: Document.create('11.222.333/0001-81', CustomerType.COMPANY),
    });
    const updated = createMockCustomer({ id: 'cust-1', type: CustomerType.COMPANY });
    customerRepository.findById.mockResolvedValue(existing);
    customerRepository.findByDocument.mockResolvedValue(null);
    customerRepository.update.mockResolvedValue(updated);
    customerRepository.hasWorkOrders.mockResolvedValue(true);

    const result = await useCase.execute('cust-1', {
      ...validInput,
      type: CustomerType.COMPANY,
      document: '12.345.678/0001-95',
    });

    expect(result).toEqual(updated);
    expect(customerRepository.hasWorkOrders).not.toHaveBeenCalled();
  });

  it('should not check for linked work orders when there is no identity change', async () => {
    const existing = createMockCustomer({
      id: 'cust-1',
      document: Document.create('12345678909', CustomerType.INDIVIDUAL),
      email: Email.create(validInput.email),
    });
    customerRepository.findById.mockResolvedValue(existing);
    customerRepository.update.mockResolvedValue(existing);

    await useCase.execute('cust-1', { ...validInput, document: '12345678909' });

    expect(customerRepository.hasWorkOrders).not.toHaveBeenCalled();
  });

  it('should delete the keys of every work order of the customer', async () => {
    const existing = createMockCustomer({ id: 'cust-1' });

    customerRepository.findById.mockResolvedValue(existing);
    customerRepository.update.mockResolvedValue(existing);
    workOrderRepository.findByCustomerId.mockResolvedValue([
      createMockWorkOrder({ id: 'wo-1' }),
      createMockWorkOrder({ id: 'wo-2' }),
    ]);

    await useCase.execute('cust-1', validInput);

    expect(workOrderRepository.findByCustomerId).toHaveBeenCalledWith('cust-1');

    expect(cache.delete).toHaveBeenCalledWith([
      workOrderCacheKey('wo-1'),
      workOrderCacheKey('wo-2'),
    ]);

    expect(cache.delete.mock.invocationCallOrder[0]).toBeGreaterThan(
      customerRepository.update.mock.invocationCallOrder[0],
    );
  });

  it('should not touch the cache when the write fails', async () => {
    customerRepository.findById.mockResolvedValue(createMockCustomer({ id: 'cust-1' }));
    customerRepository.update.mockRejectedValue(new Error('write failed'));

    await expect(useCase.execute('cust-1', validInput)).rejects.toThrow('write failed');

    expect(cache.delete).not.toHaveBeenCalled();
  });

  it('should not write the customer when the work order lookup fails', async () => {
    customerRepository.findById.mockResolvedValue(createMockCustomer({ id: 'cust-1' }));

    workOrderRepository.findByCustomerId.mockRejectedValue(new Error('lookup failed'));

    await expect(useCase.execute('cust-1', validInput)).rejects.toThrow('lookup failed');

    expect(customerRepository.update).not.toHaveBeenCalled();
  });
});
