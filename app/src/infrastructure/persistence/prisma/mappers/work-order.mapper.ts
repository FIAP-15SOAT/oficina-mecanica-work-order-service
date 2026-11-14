import type {
  WorkOrder as PrismaWorkOrder,
  Customer as PrismaCustomer,
  Vehicle as PrismaVehicle,
  WorkOrderService as PrismaWorkOrderService,
  WorkOrderPartSupply as PrismaWorkOrderPartSupply,
} from '@generated/client';
import { WorkOrder } from '@domain/entities/work-order.entity';
import { WorkOrderNumber } from '@domain/value-objects/work-order-number.vo';
import { WorkOrderStatus } from '@domain/enums/work-order-status.enum';
import { CustomerMapper } from './customer.mapper';
import { VehicleMapper } from './vehicle.mapper';
import { WorkOrderServiceMapper } from './work-order-service.mapper';
import { WorkOrderPartSupplyMapper } from './work-order-part-supply.mapper';

type PrismaWorkOrderRecord = PrismaWorkOrder & {
  customer?: PrismaCustomer | null;
  vehicle?: PrismaVehicle | null;
  services?: PrismaWorkOrderService[];
  partSupplies?: PrismaWorkOrderPartSupply[];
};

export class WorkOrderMapper {
  static toDomain(record: PrismaWorkOrderRecord): WorkOrder {
    const entity = WorkOrder.reconstitute({
      id: record.id,
      number: WorkOrderNumber.create(record.number),
      customerId: record.customerId,
      vehicleId: record.vehicleId,
      assignedUserId: record.assignedUserId ?? null,
      status: record.status as WorkOrderStatus,
      problemDescription: record.problemDescription ?? null,
      internalNotes: record.internalNotes ?? null,
      mileageAtService: record.mileageAtService ?? null,
      totalAmount: Number(record.totalAmount),
      version: record.version,
      approvedAt: record.approvedAt ?? null,
      rejectedAt: record.rejectedAt ?? null,
      startedAt: record.startedAt ?? null,
      finishedAt: record.finishedAt ?? null,
      deliveredAt: record.deliveredAt ?? null,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      services: record.services?.map((s) => WorkOrderServiceMapper.toDomain(s)),
      partSupplies: record.partSupplies?.map((p) => WorkOrderPartSupplyMapper.toDomain(p)),
    });

    if (record.customer) {
      entity.customer = CustomerMapper.toDomain(record.customer);
    }

    if (record.vehicle) {
      entity.vehicle = VehicleMapper.toDomain(record.vehicle);
    }

    return entity;
  }
}
