import { WorkOrder } from '@domain/entities/work-order.entity';
import { IUserRepository } from '@domain/interfaces/repositories/user.repository.interface';
import { IWorkOrderRepository } from '@domain/interfaces/repositories/work-order.repository.interface';
import { ResourceNotFoundException } from '@application/exceptions/resource-not-found.exception';
import { ICache } from '@application/ports/output/cache.service.interface';
import { workOrderCacheKey } from '@application/keys/work-order-cache-key';
import {
  CachedWorkOrder,
  WORK_ORDER_CACHE_VERSION,
  WorkOrderCacheMapper,
} from '@application/mappers/work-order-cache.mapper';

export class FindWorkOrderByIdUseCase {
  constructor(
    private readonly workOrderRepository: IWorkOrderRepository,
    private readonly userRepository: IUserRepository,
    private readonly cache: ICache,
  ) {}

  async execute(id: string): Promise<WorkOrder> {
    const cached = await this.findCachedWorkOrder(id);

    if (cached) {
      return cached;
    }

    const workOrder = await this.workOrderRepository.findByIdWithDetails(id);

    if (!workOrder) {
      throw new ResourceNotFoundException('Ordem de serviço', id);
    }

    await this.cacheWorkOrder(workOrder);

    return workOrder;
  }

  private async findCachedWorkOrder(id: string): Promise<WorkOrder | null> {
    const value = await this.cache.get(workOrderCacheKey(id));

    const workOrder = value === null ? null : this.parseCachedWorkOrder(value);

    if (workOrder) {
      workOrder.assignedUser = workOrder.assignedUserId
        ? await this.userRepository.findById(workOrder.assignedUserId)
        : null;
    }

    return workOrder;
  }

  // A value this code cannot read (corrupted or written by another version) is a miss.
  private parseCachedWorkOrder(value: string): WorkOrder | null {
    try {
      const cached = JSON.parse(value) as CachedWorkOrder;

      return cached.cacheVersion === WORK_ORDER_CACHE_VERSION
        ? WorkOrderCacheMapper.toDomain(cached)
        : null;
    } catch {
      return null;
    }
  }

  private async cacheWorkOrder(workOrder: WorkOrder): Promise<void> {
    await this.cache.set(
      workOrderCacheKey(workOrder.id),
      JSON.stringify(WorkOrderCacheMapper.toCache(workOrder)),
    );
  }
}
