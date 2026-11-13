import {
  BillingPaymentGatewayResponse,
  BillingWorkOrderBalanceGatewayResponse,
} from './billing-payments-gateway.response';

export interface IBillingPaymentsGateway {
  getWorkOrderBalance(workOrderId: string): Promise<BillingWorkOrderBalanceGatewayResponse>;
  listWorkOrderPayments(workOrderId: string): Promise<BillingPaymentGatewayResponse[]>;
}
