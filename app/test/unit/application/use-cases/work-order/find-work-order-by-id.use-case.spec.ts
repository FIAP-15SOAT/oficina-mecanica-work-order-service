import { randomUUID } from 'node:crypto';

import { workOrderCacheKey } from '@application/keys/work-order-cache-key';
import { WorkOrderCacheMapper } from '@application/mappers/work-order-cache.mapper';
import { FindWorkOrderByIdUseCase } from '@application/use-cases/work-order/find-work-order-by-id.use-case';
import { ResourceNotFoundException } from '@application/exceptions/resource-not-found.exception';
import { ICache } from '@application/ports/output/services/cache.service.interface';
import { WorkOrder } from '@domain/entities/work-order.entity';
import { IUserRepository } from '@domain/interfaces/repositories/user.repository.interface';
import { IWorkOrderRepository } from '@domain/interfaces/repositories/work-order.repository.interface';

import { createMockCache } from '../../../../helpers/cache-mock.factory';
import { createMockCustomer } from '../../../../helpers/customer-mock.factory';
import { createMockUser, createMockUserRepository } from '../../../../helpers/user-mock.factory';
import { createMockVehicle } from '../../../../helpers/vehicle-mock.factory';
import {
  createMockWorkOrder,
  createMockWorkOrderRepository,
} from '../../../../helpers/work-order-mock.factory';

function createDetailWorkOrder(overrides: Partial<WorkOrder> = {}): WorkOrder {
  return createMockWorkOrder({
    customer: createMockCustomer(),
    vehicle: createMockVehicle({ customer: undefined }),
    ...overrides,
  });
}

describe('FindWorkOrderByIdUseCase', () => {
  let useCase: FindWorkOrderByIdUseCase;
  let workOrderRepository: jest.Mocked<IWorkOrderRepository>;
  let userRepository: jest.Mocked<IUserRepository>;
  let cache: jest.Mocked<ICache>;

  beforeEach(() => {
    workOrderRepository = createMockWorkOrderRepository();
    userRepository = createMockUserRepository();
    cache = createMockCache();
    useCase = new FindWorkOrderByIdUseCase(workOrderRepository, userRepository, cache);
  });

  it('should return the cached work order without reading the repository', async () => {
    const user = createMockUser();

    const workOrder = createDetailWorkOrder({ assignedUserId: user.id });

    cache.get.mockResolvedValueOnce(JSON.stringify(WorkOrderCacheMapper.toCache(workOrder)));

    userRepository.findById.mockResolvedValueOnce(user);

    const result = await useCase.execute(workOrder.id);

    expect(cache.get).toHaveBeenCalledWith(workOrderCacheKey(workOrder.id));

    expect(workOrderRepository.findByIdWithDetails).not.toHaveBeenCalled();

    expect(userRepository.findById).toHaveBeenCalledWith(user.id);

    expect(result.assignedUser).toBe(user);

    expect(result).toStrictEqual(
      Object.assign(WorkOrderCacheMapper.toDomain(WorkOrderCacheMapper.toCache(workOrder)), {
        assignedUser: user,
      }),
    );
    expect(cache.set).not.toHaveBeenCalled();
  });

  it('should not look up a user for a cached work order without one', async () => {
    const workOrder = createDetailWorkOrder();

    cache.get.mockResolvedValueOnce(JSON.stringify(WorkOrderCacheMapper.toCache(workOrder)));

    const result = await useCase.execute(workOrder.id);

    expect(userRepository.findById).not.toHaveBeenCalled();
    expect(result.assignedUser).toBeNull();
  });

  it('should read the repository on a miss and cache the work order', async () => {
    const workOrder = createDetailWorkOrder();

    workOrderRepository.findByIdWithDetails.mockResolvedValueOnce(workOrder);

    const result = await useCase.execute(workOrder.id);

    expect(result).toBe(workOrder);

    expect(workOrderRepository.findByIdWithDetails).toHaveBeenCalledWith(workOrder.id);

    expect(cache.set).toHaveBeenCalledWith(
      `work-order:work-order:${workOrder.id}`,
      JSON.stringify(WorkOrderCacheMapper.toCache(workOrder)),
    );
  });

  it('should not cache a missing work order and throw ResourceNotFoundException', async () => {
    workOrderRepository.findByIdWithDetails.mockResolvedValueOnce(null);

    await expect(useCase.execute(randomUUID())).rejects.toThrow(ResourceNotFoundException);

    expect(cache.set).not.toHaveBeenCalled();
  });

  it.each([
    ['invalid JSON', () => '{"cacheVersion":'],
    [
      'an old cache version',
      (workOrder: WorkOrder) =>
        JSON.stringify({ ...WorkOrderCacheMapper.toCache(workOrder), cacheVersion: 0 }),
    ],
    [
      'a field the domain rejects',
      (workOrder: WorkOrder) =>
        JSON.stringify({ ...WorkOrderCacheMapper.toCache(workOrder), number: 'not-a-number' }),
    ],
  ])('should treat a cached value with %s as a miss', async (_, cached) => {
    const workOrder = createDetailWorkOrder();
    cache.get.mockResolvedValueOnce(cached(workOrder));

    workOrderRepository.findByIdWithDetails.mockResolvedValueOnce(workOrder);

    const result = await useCase.execute(workOrder.id);

    expect(result).toBe(workOrder);
    expect(cache.set).toHaveBeenCalledWith(
      `work-order:work-order:${workOrder.id}`,
      JSON.stringify(WorkOrderCacheMapper.toCache(workOrder)),
    );
  });
});
