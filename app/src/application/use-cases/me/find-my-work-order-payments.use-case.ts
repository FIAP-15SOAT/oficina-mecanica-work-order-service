import { IWorkOrderRepository } from '@domain/interfaces/repositories/work-order.repository.interface';
import { CustomerAccessPolicy } from '@application/policies/customer-access.policy';
import { ResourceNotFoundException } from '@application/exceptions/resource-not-found.exception';
import { IFindMyWorkOrderPaymentsUseCase } from '@application/ports/input/me/find-my-work-order-payments.use-case.interface';
import { IBillingPaymentsGateway } from '@application/ports/output/gateways/billing/billing-payments-gateway.interface';
import { BillingPaymentGatewayResponse } from '@application/ports/output/gateways/billing/billing-payments-gateway.response';

export class FindMyWorkOrderPaymentsUseCase implements IFindMyWorkOrderPaymentsUseCase {
  constructor(
    private readonly workOrderRepository: IWorkOrderRepository,
    private readonly billingPaymentsGateway: IBillingPaymentsGateway,
    private readonly customerAccessPolicy: CustomerAccessPolicy,
  ) {}

  async execute(userId: string, workOrderId: string): Promise<BillingPaymentGatewayResponse[]> {
    const workOrder = await this.workOrderRepository.findById(workOrderId);

    if (!workOrder) {
      throw new ResourceNotFoundException('Ordem de Serviço', workOrderId);
    }

    await this.customerAccessPolicy.assertCustomerAuthorized(userId, workOrder.customerId);

    return this.billingPaymentsGateway.listWorkOrderPayments(workOrderId);
  }
}
