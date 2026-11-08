import { WorkOrderService } from '@domain/entities/work-order-service.entity';
import { StatusHistory } from '@domain/entities/status-history.entity';

import { WorkOrderServiceStatus } from '@domain/enums/work-order-service-status.enum';

import { IUnitOfWork } from '@domain/interfaces/repositories/unit-of-work.interface';
import { IStatusHistoryRepository } from '@domain/interfaces/repositories/status-history.repository.interface';
import { UpdateWorkOrderServiceStatusDto } from '@application/ports/input/work-order/dto/update-work-order-service-status.dto';
import { ILogger } from '@application/ports/output/services/logger.service.interface';
import { IMetrics } from '@application/ports/output/services/metrics.service.interface';
import { BUSINESS_EVENTS } from '@application/logging/business-event.catalog';
import { recordWorkOrderTransition } from '@application/metrics/work-order-metrics';

import { ResourceNotFoundException } from '@application/exceptions/resource-not-found.exception';
import { ICache } from '@application/ports/output/services/cache.service.interface';
import { workOrderCacheKey } from '@application/keys/work-order-cache-key';

export class UpdateWorkOrderServiceStatusUseCase {
  constructor(
    private readonly unitOfWork: IUnitOfWork,
    private readonly logger: ILogger,
    private readonly metrics: IMetrics,
    private readonly statusHistoryRepository: IStatusHistoryRepository,
    private readonly cache: ICache,
  ) {}

  async execute(dto: UpdateWorkOrderServiceStatusDto): Promise<WorkOrderService> {
    const {
      item,
      workOrderId,
      workOrderNumber,
      previousStatus,
      currentStatus,
      previousServiceStatus,
      transition,
    } = await this.unitOfWork.executeTransaction(async (repos) => {
      const workOrder = await repos.workOrder.findByIdWithDetails(dto.workOrderId);

      if (!workOrder) {
        throw new ResourceNotFoundException('Ordem de Serviço', dto.workOrderId);
      }

      const previousStatus = workOrder.status;

      const previousServiceStatus = workOrder.services.find(
        (service) => service.serviceId === dto.serviceId,
      )?.status;

      if (dto.status === WorkOrderServiceStatus.IN_PROGRESS) {
        workOrder.startServiceItem(dto.serviceId);
      } else {
        workOrder.completeServiceItem(dto.serviceId);
      }

      const statusChanged = workOrder.status !== previousStatus;

      const item = workOrder.services.find((s) => s.serviceId === dto.serviceId)!;

      await repos.workOrder.updateServiceItemStatus(workOrder, item);

      if (
        dto.status === WorkOrderServiceStatus.IN_PROGRESS &&
        statusChanged &&
        workOrder.partSupplies.length > 0
      ) {
        await repos.outbox.add({
          type: 'inventory.stock.consume',
          workOrderId: workOrder.id,
          payload: {},
        });
      }

      const transition = statusChanged
        ? await repos.statusHistory.create(
            StatusHistory.create({
              workOrderId: workOrder.id,
              changedById: dto.userId,
              previousStatus,
              newStatus: workOrder.status,
              notes: null,
            }),
          )
        : undefined;

      return {
        item,
        workOrderId: workOrder.id,
        workOrderNumber: workOrder.number.toString(),
        previousStatus,
        currentStatus: workOrder.status,
        previousServiceStatus,
        transition,
      };
    });

    await this.cache.delete([workOrderCacheKey(workOrderId)]);

    this.logger.event(BUSINESS_EVENTS.WORK_ORDER_SERVICE_STATUS_UPDATED, {
      workOrderId,
      workOrderNumber,
      workOrderServiceId: item.serviceId,
      previousWorkOrderServiceStatus: previousServiceStatus,
      currentWorkOrderServiceStatus: item.status,
      previousWorkOrderStatus: previousStatus,
      currentWorkOrderStatus: currentStatus,
    });

    await recordWorkOrderTransition(this.metrics, this.statusHistoryRepository, transition);

    return item;
  }
}
