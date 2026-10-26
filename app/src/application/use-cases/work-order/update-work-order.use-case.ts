import { User } from '@domain/entities/user.entity';
import { WorkOrder } from '@domain/entities/work-order.entity';

import { IWorkOrderRepository } from '@domain/interfaces/repositories/work-order.repository.interface';
import { IUserRepository } from '@domain/interfaces/repositories/user.repository.interface';

import { UpdateWorkOrderDto } from '@application/ports/input/work-order/dto/update-work-order.dto';
import { ResourceNotFoundException } from '@application/exceptions/resource-not-found.exception';
import { ICache } from '@application/ports/output/cache.service.interface';
import { workOrderCacheKey } from '@application/keys/work-order-cache-key';

export class UpdateWorkOrderUseCase {
  constructor(
    private readonly workOrderRepository: IWorkOrderRepository,
    private readonly userRepository: IUserRepository,
    private readonly cache: ICache,
  ) {}

  async execute(id: string, dto: UpdateWorkOrderDto): Promise<WorkOrder> {
    const workOrder = await this.workOrderRepository.findById(id);

    if (!workOrder) {
      throw new ResourceNotFoundException('Ordem de serviço', id);
    }

    let assignedUser: User | null | undefined = undefined;

    if (dto.assignedUserId) {
      assignedUser = await this.userRepository.findById(dto.assignedUserId);

      if (!assignedUser) {
        throw new ResourceNotFoundException('Usuário', dto.assignedUserId);
      }
    }

    const { assignedUserId: _, ...updateData } = dto;

    workOrder.update({ ...updateData, assignedUser });

    const saved = await this.workOrderRepository.update(workOrder);

    await this.cache.delete([workOrderCacheKey(id)]);

    return saved;
  }
}
