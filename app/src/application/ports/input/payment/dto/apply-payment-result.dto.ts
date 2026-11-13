export type PaymentFailureReason = 'EXPIRED' | 'REJECTED' | 'CANCELLED';

export type ApplyPaymentResultInputDto = { paymentId: string } & (
  | { outcome: 'approved' }
  | { outcome: 'failed'; reason: PaymentFailureReason }
);
