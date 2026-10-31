import { WorkOrder } from '@domain/entities/work-order.entity';
import { WorkOrderService } from '@domain/entities/work-order-service.entity';
import { StockMovement } from '@domain/entities/stock-movement.entity';
import { StatusHistory } from '@domain/entities/status-history.entity';

import { WorkOrderServiceStatus } from '@domain/enums/work-order-service-status.enum';
import { StockMovementType } from '@domain/enums/stock-movement-type.enum';

import { IRepositories, IUnitOfWork } from '@domain/interfaces/repositories/unit-of-work.interface';
import { IStatusHistoryRepository } from '@domain/interfaces/repositories/status-history.repository.interface';
import { UpdateWorkOrderServiceStatusDto } from '@application/ports/input/work-order/dto/update-work-order-service-status.dto';
import { ILogger } from '@application/ports/output/services/logger.service.interface';
import { IMetrics } from '@application/ports/output/services/metrics.service.interface';
import { BUSINESS_EVENTS } from '@application/logging/business-event.catalog';
import { recordWorkOrderTransition } from '@application/metrics/work-order-metrics';

import { ResourceNotFoundException } from '@application/exceptions/resource-not-found.exception';
import { ICache } from '@application/ports/output/services/cache.service.interface';
import { workOrderCacheKey } from '@application/keys/work-order-cache-key';

interface StockConsumptionSummary {
  consumedItemCount: number;
  consumedQuantity: number;
}

const NO_CONSUMPTION: StockConsumptionSummary = { consumedItemCount: 0, consumedQuantity: 0 };

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
      consumption,
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

      const consumption =
        dto.status === WorkOrderServiceStatus.IN_PROGRESS && statusChanged
          ? await this.updateStockFromReservations(repos, workOrder)
          : NO_CONSUMPTION;

      const item = workOrder.services.find((s) => s.serviceId === dto.serviceId)!;

      await repos.workOrder.updateServiceItemStatus(workOrder, item);

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
        consumption,
        transition,
      };
    });

    await this.cache.delete([workOrderCacheKey(workOrderId)]);

    if (consumption.consumedItemCount > 0) {
      this.logger.event(BUSINESS_EVENTS.STOCK_CONSUMED, {
        workOrderId,
        workOrderNumber,
        ...consumption,
      });
    }

    this.logger.event(BUSINESS_EVENTS.WORK_ORDER_SERVICE_STATUS_UPDATED, {
      workOrderId,
      workOrderNumber,
      workOrderServiceId: item.serviceId,
      workOrderServiceName: item.service?.name,
      previousWorkOrderServiceStatus: previousServiceStatus,
      currentWorkOrderServiceStatus: item.status,
      previousWorkOrderStatus: previousStatus,
      currentWorkOrderStatus: currentStatus,
    });

    await recordWorkOrderTransition(this.metrics, this.statusHistoryRepository, transition);

    return item;
  }

  private async updateStockFromReservations(
    repos: IRepositories,
    workOrder: WorkOrder,
  ): Promise<StockConsumptionSummary> {
    const reservations = await repos.stockReservation.findByWorkOrderId(workOrder.id);

    if (reservations.length === 0) return NO_CONSUMPTION;

    const partSupplyIds = reservations.map((r) => r.partSupplyId);
    const partSupplies = await repos.partSupply.findByIds(partSupplyIds);

    const movements: StockMovement[] = [];
    const updates: Promise<unknown>[] = [];

    for (const reservation of reservations) {
      const partSupply = partSupplies.find((ps) => ps.id === reservation.partSupplyId)!;

      partSupply.consumeReserved(reservation.quantity);

      movements.push(
        StockMovement.create({
          partSupplyId: reservation.partSupplyId,
          workOrderId: workOrder.id,
          quantity: reservation.quantity,
          type: StockMovementType.EXIT,
          reason: `Saída por Ordem de Serviço ${workOrder.number.toString()}`,
        }),
      );

      updates.push(repos.partSupply.update(partSupply));
    }

    await Promise.all([repos.stockMovement.createMany(movements), ...updates]);

    await repos.stockReservation.deleteByWorkOrderId(workOrder.id);

    return {
      consumedItemCount: reservations.length,
      consumedQuantity: reservations.reduce((total, item) => total + item.quantity, 0),
    };
  }
}
