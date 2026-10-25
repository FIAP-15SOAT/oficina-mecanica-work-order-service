import { randomUUID } from 'node:crypto';
import { UpdateVehicleUseCase } from '@application/use-cases/vehicle/update-vehicle.use-case';
import { ResourceConflictException } from '@application/exceptions/resource-conflict.exception';
import { ResourceNotFoundException } from '@application/exceptions/resource-not-found.exception';
import { ICustomerRepository } from '@domain/interfaces/repositories/customer.repository.interface';
import { IVehicleRepository } from '@domain/interfaces/repositories/vehicle.repository.interface';
import { UpdateVehicleDto } from '@application/ports/input/vehicle/dto/update-vehicle.dto';
import {
  createMockCustomer,
  createMockCustomerRepository,
} from '../../../../helpers/customer-mock.factory';
import {
  createMockVehicle,
  createMockVehicleRepository,
} from '../../../../helpers/vehicle-mock.factory';
import { Plate } from '@domain/value-objects/plate.vo';
import { ICache } from '@application/ports/output/cache.service.interface';
import { workOrderCacheKey } from '@application/keys/work-order-cache-key';
import { createMockCache } from '../../../../helpers/cache-mock.factory';
import { IWorkOrderRepository } from '@domain/interfaces/repositories/work-order.repository.interface';
import {
  createMockWorkOrder,
  createMockWorkOrderRepository,
} from '../../../../helpers/work-order-mock.factory';

describe('UpdateVehicleUseCase', () => {
  let cache: jest.Mocked<ICache>;
  let workOrderRepository: jest.Mocked<IWorkOrderRepository>;
  let useCase: UpdateVehicleUseCase;
  let vehicleRepository: jest.Mocked<IVehicleRepository>;
  let customerRepository: jest.Mocked<ICustomerRepository>;

  const customerId1 = randomUUID();
  const customerId2 = randomUUID();
  const customerId999 = randomUUID();

  const validInput: UpdateVehicleDto = {
    customerId: customerId1,
    plate: 'ABC-1234',
    brand: 'Toyota',
    model: 'Corolla',
    year: 2020,
  };

  beforeEach(() => {
    vehicleRepository = createMockVehicleRepository();
    customerRepository = createMockCustomerRepository();
    cache = createMockCache();
    workOrderRepository = createMockWorkOrderRepository();
    useCase = new UpdateVehicleUseCase(
      vehicleRepository,
      customerRepository,
      workOrderRepository,
      cache,
    );
  });

  it('should update vehicle successfully', async () => {
    const existing = createMockVehicle({
      id: 'veh-1',
      customerId: customerId1,
      plate: Plate.create('ABC1234'),
    });
    const updated = createMockVehicle({ id: 'veh-1', brand: 'Honda' });
    vehicleRepository.findById.mockResolvedValue(existing);
    customerRepository.findById.mockResolvedValue(createMockCustomer({ id: customerId1 }));
    vehicleRepository.update.mockResolvedValue(updated);

    const result = await useCase.execute('veh-1', { ...validInput, brand: 'Honda' });

    expect(result).toEqual(updated);
    expect(vehicleRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({ brand: 'Honda' }),
    );
  });

  it('should throw ResourceNotFoundException when vehicle not found', async () => {
    vehicleRepository.findById.mockResolvedValue(null);

    await expect(useCase.execute('non-existent', validInput)).rejects.toThrow(
      ResourceNotFoundException,
    );
    expect(vehicleRepository.update).not.toHaveBeenCalled();
  });

  it('should throw ResourceConflictException when new plate belongs to another vehicle', async () => {
    const existing = createMockVehicle({
      id: 'veh-1',
      customerId: customerId1,
      plate: Plate.create('ABC1234'),
    });
    const other = createMockVehicle({ id: 'veh-2', plate: Plate.create('XYZ9999') });
    vehicleRepository.findById.mockResolvedValue(existing);
    customerRepository.findById.mockResolvedValue(createMockCustomer({ id: customerId1 }));
    vehicleRepository.findByPlate.mockResolvedValue(other);

    await expect(useCase.execute('veh-1', { ...validInput, plate: 'XYZ-9999' })).rejects.toThrow(
      ResourceConflictException,
    );
    expect(vehicleRepository.update).not.toHaveBeenCalled();
  });

  it('should throw ResourceNotFoundException when new customerId does not exist', async () => {
    const existing = createMockVehicle({ id: 'veh-1', customerId: customerId1 });
    vehicleRepository.findById.mockResolvedValue(existing);
    customerRepository.findById.mockResolvedValue(null);

    await expect(
      useCase.execute('veh-1', { ...validInput, customerId: customerId999 }),
    ).rejects.toThrow(ResourceNotFoundException);
    expect(vehicleRepository.update).not.toHaveBeenCalled();
  });

  it('should not check plate uniqueness when plate is unchanged', async () => {
    const existing = createMockVehicle({
      id: 'veh-1',
      customerId: customerId1,
      plate: Plate.create('ABC1234'),
    });
    vehicleRepository.findById.mockResolvedValue(existing);
    customerRepository.findById.mockResolvedValue(createMockCustomer({ id: customerId1 }));
    vehicleRepository.update.mockResolvedValue(existing);

    await useCase.execute('veh-1', validInput);

    expect(vehicleRepository.findByPlate).not.toHaveBeenCalled();
  });

  it('should update when customerId changes and new customer exists', async () => {
    const existing = createMockVehicle({
      id: 'veh-1',
      customerId: customerId1,
      plate: Plate.create('ABC1234'),
    });
    const newCustomer = createMockCustomer({ id: customerId2 });
    const updated = createMockVehicle({
      id: 'veh-1',
      customerId: customerId2,
      plate: Plate.create('ABC1234'),
    });
    vehicleRepository.findById.mockResolvedValue(existing);
    customerRepository.findById.mockResolvedValue(newCustomer);
    vehicleRepository.update.mockResolvedValue(updated);

    const result = await useCase.execute('veh-1', { ...validInput, customerId: customerId2 });

    expect(result).toEqual(updated);
    expect(customerRepository.findById).toHaveBeenCalledWith(customerId2);
    expect(vehicleRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: customerId2 }),
    );
  });

  it('should normalize plate to uppercase and pass it to the repository', async () => {
    const existing = createMockVehicle({
      id: 'veh-1',
      customerId: customerId1,
      plate: Plate.create('ABC1234'),
    });
    const updated = createMockVehicle({ id: 'veh-1', plate: Plate.create('XYZ9999') });
    vehicleRepository.findById.mockResolvedValue(existing);
    customerRepository.findById.mockResolvedValue(createMockCustomer({ id: customerId1 }));
    vehicleRepository.findByPlate.mockResolvedValue(null);
    vehicleRepository.update.mockResolvedValue(updated);

    await useCase.execute('veh-1', { ...validInput, plate: 'xyz-9999' });

    expect(vehicleRepository.findByPlate).toHaveBeenCalledWith('XYZ9999');
    expect(vehicleRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({ plate: expect.objectContaining({ value: 'XYZ9999' }) }),
    );
  });

  it('should delete the keys of every work order of the vehicle', async () => {
    const existing = createMockVehicle({
      id: 'veh-1',
      customerId: customerId1,
      plate: Plate.create('ABC1234'),
    });

    vehicleRepository.findById.mockResolvedValue(existing);
    vehicleRepository.update.mockResolvedValue(existing);
    workOrderRepository.findByVehicleId.mockResolvedValue([
      createMockWorkOrder({ id: 'wo-1' }),
      createMockWorkOrder({ id: 'wo-2' }),
    ]);

    await useCase.execute('veh-1', validInput);

    expect(workOrderRepository.findByVehicleId).toHaveBeenCalledWith('veh-1');

    expect(cache.delete).toHaveBeenCalledWith([
      workOrderCacheKey('wo-1'),
      workOrderCacheKey('wo-2'),
    ]);

    expect(cache.delete.mock.invocationCallOrder[0]).toBeGreaterThan(
      vehicleRepository.update.mock.invocationCallOrder[0],
    );
  });

  it('should not touch the cache when the write fails', async () => {
    vehicleRepository.findById.mockResolvedValue(
      createMockVehicle({ id: 'veh-1', customerId: customerId1, plate: Plate.create('ABC1234') }),
    );

    vehicleRepository.update.mockRejectedValue(new Error('write failed'));

    await expect(useCase.execute('veh-1', validInput)).rejects.toThrow('write failed');

    expect(cache.delete).not.toHaveBeenCalled();
  });

  it('should not write the vehicle when the work order lookup fails', async () => {
    vehicleRepository.findById.mockResolvedValue(
      createMockVehicle({ id: 'veh-1', customerId: customerId1, plate: Plate.create('ABC1234') }),
    );

    workOrderRepository.findByVehicleId.mockRejectedValue(new Error('lookup failed'));

    await expect(useCase.execute('veh-1', validInput)).rejects.toThrow('lookup failed');

    expect(vehicleRepository.update).not.toHaveBeenCalled();
  });
});
