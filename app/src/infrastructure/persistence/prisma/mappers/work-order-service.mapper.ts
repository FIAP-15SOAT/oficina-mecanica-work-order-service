import type { WorkOrderService as PrismaWorkOrderService } from '@generated/client';
import { WorkOrderService } from '@domain/entities/work-order-service.entity';
import { WorkOrderServiceStatus } from '@domain/enums/work-order-service-status.enum';

export class WorkOrderServiceMapper {
  static toDomain(record: PrismaWorkOrderService): WorkOrderService {
    return WorkOrderService.reconstitute({
      workOrderId: record.workOrderId,
      serviceId: record.serviceId,
      quantity: record.quantity,
      unitPrice: Number(record.unitPrice),
      totalPrice: Number(record.totalPrice),
      status: record.status as WorkOrderServiceStatus,
      startedAt: record.startedAt ?? null,
      finishedAt: record.finishedAt ?? null,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    });
  }
}
