import { Customer } from '@domain/entities/customer.entity';
import { PartSupply } from '@domain/entities/part-supply.entity';
import { Service } from '@domain/entities/service.entity';
import { Vehicle } from '@domain/entities/vehicle.entity';
import { WorkOrder } from '@domain/entities/work-order.entity';
import { WorkOrderPartSupply } from '@domain/entities/work-order-part-supply.entity';
import { WorkOrderService } from '@domain/entities/work-order-service.entity';
import { CustomerType } from '@domain/enums/customer-type.enum';
import { PartSupplyCategory } from '@domain/enums/part-supply-category.enum';
import { Unit } from '@domain/enums/unit.enum';
import { WorkOrderServiceStatus } from '@domain/enums/work-order-service-status.enum';
import { WorkOrderStatus } from '@domain/enums/work-order-status.enum';
import { Address } from '@domain/value-objects/address.vo';
import { Document } from '@domain/value-objects/document.vo';
import { Email } from '@domain/value-objects/email.vo';
import { Phone } from '@domain/value-objects/phone.vo';
import { Plate } from '@domain/value-objects/plate.vo';
import { WorkOrderNumber } from '@domain/value-objects/work-order-number.vo';

// Bump when the cached shape changes: values written by the previous code then read as misses.
export const WORK_ORDER_CACHE_VERSION = 1;

interface CachedCustomer {
  id: string;
  name: string;
  document: string;
  type: CustomerType;
  email: string;
  phone: string;
  address: { street: string; city: string; state: string; zipCode: string } | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface CachedVehicle {
  id: string;
  customerId: string;
  plate: string;
  brand: string;
  model: string;
  year: number;
  color: string | null;
  mileage: number | null;
  createdAt: string;
  updatedAt: string;
}

interface CachedService {
  id: string;
  name: string;
  description: string | null;
  basePrice: number;
  estimatedTimeMin: number;
  createdAt: string;
  updatedAt: string;
}

interface CachedPartSupply {
  id: string;
  name: string;
  description: string | null;
  sku: string;
  partNumber: string | null;
  category: PartSupplyCategory;
  unit: Unit;
  costPrice: number;
  salePrice: number;
  stock: number;
  minStock: number;
  reservedStock: number;
  version: number;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface CachedWorkOrderService {
  workOrderId: string;
  serviceId: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  status: WorkOrderServiceStatus;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  service: CachedService;
}

interface CachedWorkOrderPartSupply {
  workOrderId: string;
  partSupplyId: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  createdAt: string;
  updatedAt: string;
  partSupply: CachedPartSupply;
}

// No assigned user: the password hash stays out of the cache and the name is read fresh.
export interface CachedWorkOrder {
  cacheVersion: number;
  id: string;
  number: string;
  customerId: string;
  vehicleId: string;
  assignedUserId: string | null;
  status: WorkOrderStatus;
  problemDescription: string | null;
  internalNotes: string | null;
  mileageAtService: number | null;
  totalAmount: number;
  version: number;
  approvedAt: string | null;
  rejectedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
  updatedAt: string;
  customer: CachedCustomer;
  vehicle: CachedVehicle;
  services: CachedWorkOrderService[];
  partSupplies: CachedWorkOrderPartSupply[];
}

export class WorkOrderCacheMapper {
  static toCache(workOrder: WorkOrder): CachedWorkOrder {
    return {
      cacheVersion: WORK_ORDER_CACHE_VERSION,
      id: workOrder.id,
      number: workOrder.number.value,
      customerId: workOrder.customerId,
      vehicleId: workOrder.vehicleId,
      assignedUserId: workOrder.assignedUserId,
      status: workOrder.status,
      problemDescription: workOrder.problemDescription,
      internalNotes: workOrder.internalNotes,
      mileageAtService: workOrder.mileageAtService,
      totalAmount: workOrder.totalAmount,
      version: workOrder.version,
      approvedAt: WorkOrderCacheMapper.toIso(workOrder.approvedAt),
      rejectedAt: WorkOrderCacheMapper.toIso(workOrder.rejectedAt),
      startedAt: WorkOrderCacheMapper.toIso(workOrder.startedAt),
      finishedAt: WorkOrderCacheMapper.toIso(workOrder.finishedAt),
      deliveredAt: WorkOrderCacheMapper.toIso(workOrder.deliveredAt),
      createdAt: workOrder.createdAt.toISOString(),
      updatedAt: workOrder.updatedAt.toISOString(),
      customer: WorkOrderCacheMapper.toCachedCustomer(workOrder.customer!),
      vehicle: WorkOrderCacheMapper.toCachedVehicle(workOrder.vehicle!),
      services: workOrder.services.map((item) =>
        WorkOrderCacheMapper.toCachedWorkOrderService(item),
      ),
      partSupplies: workOrder.partSupplies.map((item) =>
        WorkOrderCacheMapper.toCachedWorkOrderPartSupply(item),
      ),
    };
  }

  static toDomain(cached: CachedWorkOrder): WorkOrder {
    const workOrder = WorkOrder.reconstitute({
      id: cached.id,
      number: WorkOrderNumber.create(cached.number),
      customerId: cached.customerId,
      vehicleId: cached.vehicleId,
      assignedUserId: cached.assignedUserId,
      status: cached.status,
      problemDescription: cached.problemDescription,
      internalNotes: cached.internalNotes,
      mileageAtService: cached.mileageAtService,
      totalAmount: cached.totalAmount,
      version: cached.version,
      approvedAt: WorkOrderCacheMapper.toDate(cached.approvedAt),
      rejectedAt: WorkOrderCacheMapper.toDate(cached.rejectedAt),
      startedAt: WorkOrderCacheMapper.toDate(cached.startedAt),
      finishedAt: WorkOrderCacheMapper.toDate(cached.finishedAt),
      deliveredAt: WorkOrderCacheMapper.toDate(cached.deliveredAt),
      createdAt: new Date(cached.createdAt),
      updatedAt: new Date(cached.updatedAt),
      services: cached.services.map((item) =>
        WorkOrderCacheMapper.fromCachedWorkOrderService(item),
      ),
      partSupplies: cached.partSupplies.map((item) =>
        WorkOrderCacheMapper.fromCachedWorkOrderPartSupply(item),
      ),
    });

    workOrder.customer = WorkOrderCacheMapper.fromCachedCustomer(cached.customer);
    workOrder.vehicle = WorkOrderCacheMapper.fromCachedVehicle(cached.vehicle);

    return workOrder;
  }

  private static toIso(date: Date | null): string | null {
    return date ? date.toISOString() : null;
  }

  private static toDate(value: string | null): Date | null {
    return value === null ? null : new Date(value);
  }

  private static toCachedCustomer(customer: Customer): CachedCustomer {
    return {
      id: customer.id,
      name: customer.name,
      document: customer.document.value,
      type: customer.type,
      email: customer.email.value,
      phone: customer.phone.value,
      address: customer.address
        ? {
            street: customer.address.street,
            city: customer.address.city,
            state: customer.address.state,
            zipCode: customer.address.zipCode.value,
          }
        : null,
      isActive: customer.isActive,
      createdAt: customer.createdAt.toISOString(),
      updatedAt: customer.updatedAt.toISOString(),
    };
  }

  private static fromCachedCustomer(cached: CachedCustomer): Customer {
    return Customer.reconstitute({
      id: cached.id,
      name: cached.name,
      document: Document.create(cached.document, cached.type),
      type: cached.type,
      email: Email.create(cached.email),
      phone: Phone.create(cached.phone),
      address: cached.address ? Address.create(cached.address) : null,
      isActive: cached.isActive,
      createdAt: new Date(cached.createdAt),
      updatedAt: new Date(cached.updatedAt),
    });
  }

  private static toCachedVehicle(vehicle: Vehicle): CachedVehicle {
    return {
      id: vehicle.id,
      customerId: vehicle.customerId,
      plate: vehicle.plate.value,
      brand: vehicle.brand,
      model: vehicle.model,
      year: vehicle.year,
      color: vehicle.color,
      mileage: vehicle.mileage,
      createdAt: vehicle.createdAt.toISOString(),
      updatedAt: vehicle.updatedAt.toISOString(),
    };
  }

  private static fromCachedVehicle(cached: CachedVehicle): Vehicle {
    return Vehicle.reconstitute({
      id: cached.id,
      customerId: cached.customerId,
      plate: Plate.create(cached.plate),
      brand: cached.brand,
      model: cached.model,
      year: cached.year,
      color: cached.color,
      mileage: cached.mileage,
      createdAt: new Date(cached.createdAt),
      updatedAt: new Date(cached.updatedAt),
    });
  }

  private static toCachedWorkOrderService(item: WorkOrderService): CachedWorkOrderService {
    const service = item.service!;

    return {
      workOrderId: item.workOrderId,
      serviceId: item.serviceId,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      totalPrice: item.totalPrice,
      status: item.status,
      startedAt: WorkOrderCacheMapper.toIso(item.startedAt),
      finishedAt: WorkOrderCacheMapper.toIso(item.finishedAt),
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
      service: {
        id: service.id,
        name: service.name,
        description: service.description,
        basePrice: service.basePrice,
        estimatedTimeMin: service.estimatedTimeMin,
        createdAt: service.createdAt.toISOString(),
        updatedAt: service.updatedAt.toISOString(),
      },
    };
  }

  private static fromCachedWorkOrderService(cached: CachedWorkOrderService): WorkOrderService {
    const item = WorkOrderService.reconstitute({
      workOrderId: cached.workOrderId,
      serviceId: cached.serviceId,
      quantity: cached.quantity,
      unitPrice: cached.unitPrice,
      totalPrice: cached.totalPrice,
      status: cached.status,
      startedAt: WorkOrderCacheMapper.toDate(cached.startedAt),
      finishedAt: WorkOrderCacheMapper.toDate(cached.finishedAt),
      createdAt: new Date(cached.createdAt),
      updatedAt: new Date(cached.updatedAt),
    });

    item.service = Service.reconstitute({
      ...cached.service,
      createdAt: new Date(cached.service.createdAt),
      updatedAt: new Date(cached.service.updatedAt),
    });

    return item;
  }

  private static toCachedWorkOrderPartSupply(item: WorkOrderPartSupply): CachedWorkOrderPartSupply {
    const partSupply = item.partSupply!;

    return {
      workOrderId: item.workOrderId,
      partSupplyId: item.partSupplyId,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      totalPrice: item.totalPrice,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
      partSupply: {
        id: partSupply.id,
        name: partSupply.name,
        description: partSupply.description,
        sku: partSupply.sku,
        partNumber: partSupply.partNumber,
        category: partSupply.category,
        unit: partSupply.unit,
        costPrice: partSupply.costPrice,
        salePrice: partSupply.salePrice,
        stock: partSupply.stock,
        minStock: partSupply.minStock,
        reservedStock: partSupply.reservedStock,
        version: partSupply.version,
        expiresAt: WorkOrderCacheMapper.toIso(partSupply.expiresAt),
        createdAt: partSupply.createdAt.toISOString(),
        updatedAt: partSupply.updatedAt.toISOString(),
      },
    };
  }

  private static fromCachedWorkOrderPartSupply(
    cached: CachedWorkOrderPartSupply,
  ): WorkOrderPartSupply {
    const item = WorkOrderPartSupply.reconstitute({
      workOrderId: cached.workOrderId,
      partSupplyId: cached.partSupplyId,
      quantity: cached.quantity,
      unitPrice: cached.unitPrice,
      totalPrice: cached.totalPrice,
      createdAt: new Date(cached.createdAt),
      updatedAt: new Date(cached.updatedAt),
    });

    item.partSupply = PartSupply.reconstitute({
      ...cached.partSupply,
      expiresAt: WorkOrderCacheMapper.toDate(cached.partSupply.expiresAt),
      createdAt: new Date(cached.partSupply.createdAt),
      updatedAt: new Date(cached.partSupply.updatedAt),
    });

    return item;
  }
}
