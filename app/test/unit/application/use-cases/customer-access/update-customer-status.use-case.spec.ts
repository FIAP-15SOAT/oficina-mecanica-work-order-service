import { randomUUID } from 'node:crypto';
import { UpdateCustomerStatusUseCase } from '@application/use-cases/customer-access/update-customer-status.use-case';
import { Customer } from '@domain/entities/customer.entity';
import { CustomerType } from '@domain/enums/customer-type.enum';
import { ResourceNotFoundException } from '@application/exceptions/resource-not-found.exception';
import { ICustomerRepository } from '@domain/interfaces/repositories/customer.repository.interface';
import { IWorkOrderRepository } from '@domain/interfaces/repositories/work-order.repository.interface';
import { ICache } from '@application/ports/output/cache.service.interface';
import { ILogger } from '@application/ports/output/logger.service.interface';
import { workOrderCacheKey } from '@application/keys/work-order-cache-key';
import { createMockCustomerRepository } from '../../../../helpers/customer-mock.factory';
import {
  createMockWorkOrder,
  createMockWorkOrderRepository,
} from '../../../../helpers/work-order-mock.factory';
import { createMockCache } from '../../../../helpers/cache-mock.factory';
import { createMockLogger } from '../../../../helpers/logger-mock.factory';

function buildCustomer(): Customer {
  return Customer.create({
    name: 'João da Silva',
    document: '12345678909',
    type: CustomerType.INDIVIDUAL,
    email: 'joao@example.com',
    phone: '11999990000',
    address: { street: 'Rua A', city: 'São Paulo', state: 'SP', zipCode: '01001000' },
  });
}

describe('UpdateCustomerStatusUseCase', () => {
  let customerRepository: jest.Mocked<ICustomerRepository>;
  let workOrderRepository: jest.Mocked<IWorkOrderRepository>;
  let cache: jest.Mocked<ICache>;
  let logger: jest.Mocked<ILogger>;
  let useCase: UpdateCustomerStatusUseCase;

  beforeEach(() => {
    customerRepository = createMockCustomerRepository();
    customerRepository.update.mockImplementation((customer) => Promise.resolve(customer));
    workOrderRepository = createMockWorkOrderRepository();
    cache = createMockCache();
    logger = createMockLogger();
    useCase = new UpdateCustomerStatusUseCase(
      customerRepository,
      workOrderRepository,
      cache,
      logger,
    );
  });

  it('should deactivate an active customer', async () => {
    const customer = buildCustomer();
    customerRepository.findById.mockResolvedValue(customer);

    await useCase.execute(customer.id, false, randomUUID());

    expect(customerRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({ isActive: false }),
    );
    expect(logger.event).toHaveBeenCalled();
  });

  it('should reactivate a deactivated customer', async () => {
    const customer = buildCustomer();
    customer.deactivate();
    customerRepository.findById.mockResolvedValue(customer);

    await useCase.execute(customer.id, true, randomUUID());

    expect(customerRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({ isActive: true }),
    );
  });

  it('should throw when the customer does not exist', async () => {
    customerRepository.findById.mockResolvedValue(null);

    await expect(useCase.execute(randomUUID(), false, randomUUID())).rejects.toThrow(
      ResourceNotFoundException,
    );
  });

  it('should delete the keys of every work order of the customer after the write', async () => {
    const customer = buildCustomer();
    customerRepository.findById.mockResolvedValue(customer);
    workOrderRepository.findByCustomerId.mockResolvedValue([
      createMockWorkOrder({ id: 'wo-1' }),
      createMockWorkOrder({ id: 'wo-2' }),
    ]);

    await useCase.execute(customer.id, false, randomUUID());

    expect(workOrderRepository.findByCustomerId).toHaveBeenCalledWith(customer.id);

    expect(cache.delete).toHaveBeenCalledWith([
      workOrderCacheKey('wo-1'),
      workOrderCacheKey('wo-2'),
    ]);

    expect(cache.delete.mock.invocationCallOrder[0]).toBeGreaterThan(
      customerRepository.update.mock.invocationCallOrder[0],
    );
  });

  it('should not touch the cache when the write fails', async () => {
    customerRepository.findById.mockResolvedValue(buildCustomer());
    customerRepository.update.mockRejectedValue(new Error('write failed'));

    await expect(useCase.execute(randomUUID(), false, randomUUID())).rejects.toThrow(
      'write failed',
    );

    expect(cache.delete).not.toHaveBeenCalled();
  });

  it('should not write the customer when the work order lookup fails', async () => {
    customerRepository.findById.mockResolvedValue(buildCustomer());
    workOrderRepository.findByCustomerId.mockRejectedValue(new Error('lookup failed'));

    await expect(useCase.execute(randomUUID(), false, randomUUID())).rejects.toThrow(
      'lookup failed',
    );

    expect(customerRepository.update).not.toHaveBeenCalled();
  });
});
