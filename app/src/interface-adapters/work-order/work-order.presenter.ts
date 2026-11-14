import { WorkOrder } from '@domain/entities/work-order.entity';
import { StatusHistory } from '@domain/entities/status-history.entity';
import { WorkOrderService } from '@domain/entities/work-order-service.entity';
import { WorkOrderPartSupply } from '@domain/entities/work-order-part-supply.entity';
import { Customer } from '@domain/entities/customer.entity';
import { Vehicle } from '@domain/entities/vehicle.entity';
import { PaginatedResult } from '@domain/interfaces/common/pagination.interface';
import { IdentityUserGatewayResponse } from '@application/ports/output/gateways/identity/identity-users-gateway.response';
import { FindCatalogItemsOutputDto } from '@application/ports/input/catalog/dto/find-catalog-items.dto';
import {
  InventoryPartSupplyGatewayResponse,
  InventoryServiceGatewayResponse,
} from '@application/ports/output/gateways/inventory/inventory-catalog-gateway.response';
import {
  WorkOrderAssignedUserResponse,
  WorkOrderCustomerResponse,
  WorkOrderDataResponse,
  WorkOrderPaginatedResponse,
  WorkOrderPartSupplyItemResponse,
  WorkOrderResponse,
  WorkOrderServiceItemResponse,
  WorkOrderServiceItemDataResponse,
  WorkOrderVehicleResponse,
} from './responses/work-order.response';
import {
  StatusHistoryListResponse,
  StatusHistoryResponse,
} from './responses/status-history.response';

export class WorkOrderPresenter {
  static toSummaryResponse(
    workOrder: WorkOrder,
    users: readonly IdentityUserGatewayResponse[],
  ): WorkOrderResponse {
    return {
      id: workOrder.id,
      number: workOrder.number.toString(),
      customer: WorkOrderPresenter.toCustomer(workOrder.customer!),
      vehicle: WorkOrderPresenter.toVehicle(workOrder.vehicle!),
      assignedUser: WorkOrderPresenter.toUser(users, workOrder.assignedUserId),
      status: workOrder.status,
      problemDescription: workOrder.problemDescription,
      internalNotes: workOrder.internalNotes,
      mileageAtService: workOrder.mileageAtService,
      totalAmount: workOrder.totalAmount,
      approvedAt: workOrder.approvedAt,
      startedAt: workOrder.startedAt,
      finishedAt: workOrder.finishedAt,
      deliveredAt: workOrder.deliveredAt,
      createdAt: workOrder.createdAt,
      updatedAt: workOrder.updatedAt,
    };
  }

  static toResponse(
    workOrder: WorkOrder,
    catalog: FindCatalogItemsOutputDto,
    users: readonly IdentityUserGatewayResponse[],
  ): WorkOrderResponse {
    return {
      ...WorkOrderPresenter.toSummaryResponse(workOrder, users),
      services: workOrder.services.map((item) =>
        WorkOrderPresenter.toServiceItem(
          item,
          catalog.services.find((service) => service.id === item.serviceId),
        ),
      ),
      partSupplies: workOrder.partSupplies.map((item) =>
        WorkOrderPresenter.toPartSupplyItem(
          item,
          catalog.partsSupplies.find((partSupply) => partSupply.id === item.partSupplyId),
        ),
      ),
    };
  }

  static toDataResponse(
    workOrder: WorkOrder,
    catalog: FindCatalogItemsOutputDto,
    users: readonly IdentityUserGatewayResponse[],
  ): WorkOrderDataResponse {
    return { data: WorkOrderPresenter.toResponse(workOrder, catalog, users) };
  }

  static toPaginatedResponse(
    paginatedResult: PaginatedResult<WorkOrder>,
    users: readonly IdentityUserGatewayResponse[],
  ): WorkOrderPaginatedResponse {
    const { items, pagination } = paginatedResult;
    return {
      data: items.map((wo) => WorkOrderPresenter.toSummaryResponse(wo, users)),
      pagination,
    };
  }

  static toStatusHistoryListResponse(
    history: StatusHistory[],
    users: readonly IdentityUserGatewayResponse[],
  ): StatusHistoryListResponse {
    return {
      data: history.map(
        (entry): StatusHistoryResponse => ({
          id: entry.id,
          changedBy: WorkOrderPresenter.toUser(users, entry.changedById),
          previousStatus: entry.previousStatus,
          newStatus: entry.newStatus,
          notes: entry.notes,
          createdAt: entry.createdAt,
        }),
      ),
    };
  }

  static toServiceItemDataResponse(
    item: WorkOrderService,
    catalog: FindCatalogItemsOutputDto,
  ): WorkOrderServiceItemDataResponse {
    return {
      data: WorkOrderPresenter.toServiceItem(
        item,
        catalog.services.find((service) => service.id === item.serviceId),
      ),
    };
  }

  private static toCustomer(customer: Customer): WorkOrderCustomerResponse {
    return {
      id: customer.id,
      name: customer.name,
      type: customer.type,
      document: customer.document.value,
      email: customer.email.value,
      phone: customer.phone.value,
    };
  }

  private static toVehicle(vehicle: Vehicle): WorkOrderVehicleResponse {
    return {
      id: vehicle.id,
      plate: vehicle.plate.value,
      brand: vehicle.brand,
      model: vehicle.model,
      year: vehicle.year,
      color: vehicle.color,
      mileage: vehicle.mileage,
    };
  }

  private static toUser(
    users: readonly IdentityUserGatewayResponse[],
    userId: string | null,
  ): WorkOrderAssignedUserResponse | null {
    const user = users.find((candidate) => candidate.id === userId);

    return user ? { id: user.id, name: user.name, email: user.email, role: user.role } : null;
  }

  private static toServiceItem(
    item: WorkOrderService,
    service: InventoryServiceGatewayResponse | undefined,
  ): WorkOrderServiceItemResponse {
    return {
      id: item.serviceId,
      name: service?.name ?? null,
      description: service?.description ?? null,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      totalPrice: item.totalPrice,
      status: item.status,
      startedAt: item.startedAt,
      finishedAt: item.finishedAt,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
  }

  private static toPartSupplyItem(
    item: WorkOrderPartSupply,
    partSupply: InventoryPartSupplyGatewayResponse | undefined,
  ): WorkOrderPartSupplyItemResponse {
    return {
      id: item.partSupplyId,
      name: partSupply?.name ?? null,
      description: partSupply?.description ?? null,
      sku: partSupply?.sku ?? null,
      partNumber: partSupply?.partNumber ?? null,
      category: partSupply?.category ?? null,
      unit: partSupply?.unit ?? null,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      totalPrice: item.totalPrice,
    };
  }
}
