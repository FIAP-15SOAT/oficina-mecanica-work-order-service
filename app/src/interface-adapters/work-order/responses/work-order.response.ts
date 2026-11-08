import { WorkOrderStatus } from '@domain/enums/work-order-status.enum';
import { CustomerType } from '@domain/enums/customer-type.enum';
import { UserRole } from '@domain/enums/user-role.enum';
import { WorkOrderServiceStatus } from '@domain/enums/work-order-service-status.enum';
import { PaginationMeta } from '@domain/interfaces/common/pagination.interface';

export interface WorkOrderCustomerResponse {
  id: string;
  name: string;
  type: CustomerType;
  document: string;
  email: string;
  phone: string;
}

export interface WorkOrderVehicleResponse {
  id: string;
  plate: string;
  brand: string;
  model: string;
  year: number;
  color: string | null;
  mileage: number | null;
}

export interface WorkOrderAssignedUserResponse {
  id: string;
  name: string;
  email: string;
  role: UserRole | null;
}

export interface WorkOrderServiceItemResponse {
  id: string;
  name: string | null;
  description: string | null;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  status: WorkOrderServiceStatus;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface WorkOrderPartSupplyItemResponse {
  id: string;
  name: string | null;
  description: string | null;
  sku: string | null;
  partNumber: string | null;
  category: string | null;
  unit: string | null;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
}

export interface WorkOrderResponse {
  id: string;
  number: string;
  customer: WorkOrderCustomerResponse;
  vehicle: WorkOrderVehicleResponse;
  assignedUser: WorkOrderAssignedUserResponse | null;
  status: WorkOrderStatus;
  problemDescription: string | null;
  internalNotes: string | null;
  mileageAtService: number | null;
  totalAmount: number;
  approvedAt: Date | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  deliveredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  services?: WorkOrderServiceItemResponse[];
  partSupplies?: WorkOrderPartSupplyItemResponse[];
}

export interface WorkOrderDataResponse {
  data: WorkOrderResponse;
}

export interface WorkOrderPaginatedResponse {
  data: WorkOrderResponse[];
  pagination: PaginationMeta;
}

export interface WorkOrderServiceItemDataResponse {
  data: WorkOrderServiceItemResponse;
}
