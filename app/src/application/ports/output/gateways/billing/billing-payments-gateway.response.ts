export enum BillingPaymentStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  EXPIRED = 'EXPIRED',
  CANCELLED = 'CANCELLED',
  REJECTED = 'REJECTED',
}

export interface BillingWorkOrderBalanceGatewayResponse {
  /** Decimal text, e.g. "500.00". */
  approvedTotal: string;
  paidTotal: string;
  balance: string;
}

export interface BillingPaymentGatewayResponse {
  id: string;
  workOrderId: string;
  checkoutId: string;
  amount: number;
  status: BillingPaymentStatus;
  checkoutUrl: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}
