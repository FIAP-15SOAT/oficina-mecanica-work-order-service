import { BillingPaymentGatewayResponse } from '@application/ports/output/gateways/billing/billing-payments-gateway.response';

export interface IFindMyWorkOrderPaymentsUseCase {
  execute(userId: string, workOrderId: string): Promise<BillingPaymentGatewayResponse[]>;
}
