export interface StartPaymentInputDto {
  paymentId: string;
  workOrderId: string;
  amount: string;
  checkoutUrl: string;
  expiresAt: string;
}
