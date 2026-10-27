import { UserRole } from '@domain/enums/user-role.enum';
import { CustomerType } from '@domain/enums/customer-type.enum';
import { QuoteStatus } from '@domain/enums/quote-status.enum';
import { WorkOrderStatus } from '@domain/enums/work-order-status.enum';
import { PaginationMeta } from '@domain/interfaces/common/pagination.interface';

export interface MyCustomerSummary {
  id: string;
  name: string;
  type: CustomerType;
}

export interface MeResponse {
  id: string;
  name: string;
  email: string;
  role: UserRole | null;
  customers: MyCustomerSummary[];
}

export interface MeDataResponse {
  data: MeResponse;
}

export interface MyVehicleSummary {
  id: string;
  plate: string;
  brand: string;
  model: string;
}

export interface MyWorkOrderResponse {
  id: string;
  number: string;
  status: WorkOrderStatus;
  problemDescription: string | null;
  mileageAtService: number | null;
  customer: MyCustomerSummary;
  vehicle: MyVehicleSummary | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MyWorkOrderDataResponse {
  data: MyWorkOrderResponse;
}

export interface MyWorkOrderPaginatedResponse {
  data: MyWorkOrderResponse[];
  pagination: PaginationMeta;
}

export interface MyQuoteItemResponse {
  id: string;
  name: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
}

/**
 * Summary — used in listings, where the items are not loaded
 * (`findByWorkOrderId` leaves out `services`/`partsSupplies` on purpose,
 * so a list row does not pull N items).
 */
export interface MyQuoteSummaryResponse {
  id: string;
  status: QuoteStatus;
  servicesAmount: number;
  partsAmount: number;
  totalAmount: number;
  notes: string | null;
  sentAt: Date | null;
  approvedAt: Date | null;
  rejectedAt: Date | null;
}

/** Detail — requires a Quote loaded with `findByIdWithDetails`. */
export interface MyQuoteResponse extends MyQuoteSummaryResponse {
  services: MyQuoteItemResponse[];
  partsSupplies: MyQuoteItemResponse[];
}

export interface MyQuoteDataResponse {
  data: MyQuoteResponse;
}

export interface MyQuoteListResponse {
  data: MyQuoteSummaryResponse[];
}
