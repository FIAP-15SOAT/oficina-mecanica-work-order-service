import { WorkOrder } from '@domain/entities/work-order.entity';

import { IWorkOrderRepository } from '@domain/interfaces/repositories/work-order.repository.interface';

import { MechanicAssignmentPolicy } from '@application/services/mechanic-assignment-policy';
import { UpdateWorkOrderDto } from '@application/ports/input/work-order/dto/update-work-order.dto';
import { ResourceNotFoundException } from '@application/exceptions/resource-not-found.exception';
import { ICache } from '@application/ports/output/services/cache.service.interface';
import { workOrderCacheKey } from '@application/keys/work-order-cache-key';

export class UpdateWorkOrderUseCase {
  constructor(
    private readonly workOrderRepository: IWorkOrderRepository,
    private readonly mechanicAssignmentPolicy: MechanicAssignmentPolicy,
    private readonly cache: ICache,
  ) {}

  async execute(id: string, dto: UpdateWorkOrderDto): Promise<WorkOrder> {
    const workOrder = await this.workOrderRepository.findById(id);

    if (!workOrder) {
      throw new ResourceNotFoundException('Ordem de serviço', id);
    }

    if (dto.assignedUserId) {
      await this.mechanicAssignmentPolicy.ensureAssignable(dto.assignedUserId);
    }

    workOrder.update({ ...dto, assignedUserId: dto.assignedUserId ?? undefined });

    const saved = await this.workOrderRepository.update(workOrder);

    await this.cache.delete([workOrderCacheKey(id)]);

    return saved;
  }
}
