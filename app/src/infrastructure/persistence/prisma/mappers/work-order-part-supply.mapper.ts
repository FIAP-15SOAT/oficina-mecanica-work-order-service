import type { WorkOrderPartSupply as PrismaWorkOrderPartSupply } from '@generated/client';
import { WorkOrderPartSupply } from '@domain/entities/work-order-part-supply.entity';

export class WorkOrderPartSupplyMapper {
  static toDomain(record: PrismaWorkOrderPartSupply): WorkOrderPartSupply {
    return WorkOrderPartSupply.reconstitute({
      workOrderId: record.workOrderId,
      partSupplyId: record.partSupplyId,
      quantity: record.quantity,
      unitPrice: Number(record.unitPrice),
      totalPrice: Number(record.totalPrice),
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    });
  }
}
