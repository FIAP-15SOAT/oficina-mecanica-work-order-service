export enum BillingQuoteStatus {
  PENDING = 'PENDING',
  SENT = 'SENT',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

export interface BillingQuoteGatewayResponse {
  id: string;
  workOrderId: string;
  status: BillingQuoteStatus;
  notes: string | null;
  decidedBy: string | null;
  rejectionReason: string | null;
  sentAt: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  servicesAmount: number;
  partsAmount: number;
  totalAmount: number;
  createdAt: string;
  updatedAt: string;
}

export interface BillingQuoteServiceItemGatewayResponse {
  /** Id of the service in the catalog. */
  id: string;
  name: string | null;
  description: string | null;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  createdAt: string;
  updatedAt: string;
}

export interface BillingQuotePartSupplyItemGatewayResponse {
  /** Id of the part or supply in the catalog. */
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
  createdAt: string;
  updatedAt: string;
}

export interface BillingQuoteWithItemsGatewayResponse extends BillingQuoteGatewayResponse {
  services: BillingQuoteServiceItemGatewayResponse[];
  partsSupplies: BillingQuotePartSupplyItemGatewayResponse[];
}
