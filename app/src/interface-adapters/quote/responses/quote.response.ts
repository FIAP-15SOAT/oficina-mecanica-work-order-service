import type { WorkOrderResponse } from '@interface-adapters/work-order/responses/work-order.response';
import { QuoteStatus } from '@domain/enums/quote-status.enum';
import { PaginationMeta } from '@domain/interfaces/common/pagination.interface';

export interface QuoteServiceItemResponse {
  id: string;
  name: string | null;
  description: string | null;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface QuotePartSupplyItemResponse {
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
  createdAt: Date;
  updatedAt: Date;
}

export interface QuoteResponse {
  id: string;
  workOrder: WorkOrderResponse;
  status: QuoteStatus;
  notes: string | null;
  sentAt: Date | null;
  approvedAt: Date | null;
  rejectedAt: Date | null;
  servicesAmount: number;
  partsAmount: number;
  totalAmount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface QuoteWithItemsResponse extends QuoteResponse {
  services: QuoteServiceItemResponse[];
  partsSupplies: QuotePartSupplyItemResponse[];
}

export interface QuoteDataResponse {
  data: QuoteResponse;
}

export interface QuoteWithItemsDataResponse {
  data: QuoteWithItemsResponse;
}

export interface QuoteListResponse {
  data: QuoteResponse[];
}

export interface QuotePaginatedResponse {
  data: QuoteResponse[];
  pagination: PaginationMeta;
}
