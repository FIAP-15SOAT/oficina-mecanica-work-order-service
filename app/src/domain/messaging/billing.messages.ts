export interface BillingMessagePayloads {
  'billing.quote.revert_approval': { quoteId: string; revertTo: 'SENT' | 'REJECTED' };
  'billing.quote.sent': {
    quoteId: string;
    sentBy: string;
    total: string;
    items: { name: string; quantity: number; unitPrice: string }[];
  };
  'billing.quote.rejected': {
    quoteId: string;
    reason: string;
    remainingSentCount: number;
    decidedBy: string;
  };
  'billing.quote.approved': {
    quoteId: string;
    decidedBy: string;
    total: string;
    services: { serviceId: string; quantity: number; unitPrice: string }[];
    partsSupplies: { partSupplyId: string; quantity: number; unitPrice: string }[];
  };
  'billing.quote.approval_reverted': { quoteId: string; revertTo: 'SENT' | 'REJECTED' };
  'billing.payment.cancel': { paymentId: string; reason: string };
  'billing.payment.requested': {
    paymentId: string;
    amount: string;
    checkoutUrl: string;
    expiresAt: string;
  };
  'billing.payment.approved': { paymentId: string; amount: string; paidAt: string };
  'billing.payment.failed': { paymentId: string; reason: 'EXPIRED' | 'REJECTED' | 'CANCELLED' };
}
