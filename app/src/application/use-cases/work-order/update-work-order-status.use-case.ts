import { WorkOrder } from '@domain/entities/work-order.entity';
import { StatusHistory } from '@domain/entities/status-history.entity';
import { WorkOrderStatus } from '@domain/enums/work-order-status.enum';

import { IUnitOfWork } from '@domain/interfaces/repositories/unit-of-work.interface';
import { IStatusHistoryRepository } from '@domain/interfaces/repositories/status-history.repository.interface';
import { UpdateWorkOrderStatusDto } from '@application/ports/input/work-order/dto/update-work-order-status.dto';
import { ILogger } from '@application/ports/output/services/logger.service.interface';
import { IMetrics } from '@application/ports/output/services/metrics.service.interface';
import { BUSINESS_EVENTS } from '@application/logging/business-event.catalog';
import { recordWorkOrderTransition } from '@application/metrics/work-order-metrics';

import { ResourceNotFoundException } from '@application/exceptions/resource-not-found.exception';
import { BusinessRuleViolationException } from '@domain/exceptions/business-rule-violation.exception';
import { ICache } from '@application/ports/output/services/cache.service.interface';
import { workOrderCacheKey } from '@application/keys/work-order-cache-key';

export class UpdateWorkOrderStatusUseCase {
  private static readonly PATCH_STATUS_ALLOWED = new Set<WorkOrderStatus>([
    WorkOrderStatus.IN_DIAGNOSIS,
    WorkOrderStatus.CANCELLED,
    WorkOrderStatus.DELIVERED,
  ]);

  constructor(
    private readonly unitOfWork: IUnitOfWork,
    private readonly logger: ILogger,
    private readonly metrics: IMetrics,
    private readonly statusHistoryRepository: IStatusHistoryRepository,
    private readonly cache: ICache,
  ) {}

  async execute(id: string, dto: UpdateWorkOrderStatusDto): Promise<WorkOrder> {
    const { workOrder, previousStatus, transition } = await this.unitOfWork.executeTransaction(
      async (repos) => {
        const workOrder = await repos.workOrder.findById(id);

        if (!workOrder) {
          throw new ResourceNotFoundException('Ordem de serviço não encontrada');
        }

        if (!UpdateWorkOrderStatusUseCase.PATCH_STATUS_ALLOWED.has(dto.status)) {
          throw new BusinessRuleViolationException(
            `O status "${dto.status}" não é permitido nesta operação.`,
          );
        }

        const previousStatus = workOrder.status;
        workOrder.changeStatus(dto.status, dto.notes);

        const saved = await repos.workOrder.update(workOrder);

        const transition = await repos.statusHistory.create(
          StatusHistory.create({
            workOrderId: saved.id,
            changedById: dto.userId,
            previousStatus,
            newStatus: dto.status,
            notes: dto.notes,
          }),
        );

        return { workOrder: saved, previousStatus, transition };
      },
    );

    await this.cache.delete([workOrderCacheKey(workOrder.id)]);

    this.logger.event(BUSINESS_EVENTS.WORK_ORDER_STATUS_UPDATED, {
      workOrderId: workOrder.id,
      workOrderNumber: workOrder.number.toString(),
      previousWorkOrderStatus: previousStatus,
      currentWorkOrderStatus: workOrder.status,
    });

    await recordWorkOrderTransition(this.metrics, this.statusHistoryRepository, transition);

    return workOrder;
  }
}
