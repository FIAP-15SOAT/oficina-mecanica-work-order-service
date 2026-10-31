import { ICustomerRepository } from '@domain/interfaces/repositories/customer.repository.interface';
import { IWorkOrderRepository } from '@domain/interfaces/repositories/work-order.repository.interface';
import { ICache } from '@application/ports/output/services/cache.service.interface';
import { workOrderCacheKey } from '@application/keys/work-order-cache-key';
import { ILogger } from '@application/ports/output/services/logger.service.interface';
import { BUSINESS_EVENTS } from '@application/logging/business-event.catalog';
import { ResourceNotFoundException } from '@application/exceptions/resource-not-found.exception';
import { IUpdateCustomerStatusUseCase } from '@application/ports/input/customer-access/update-customer-status.use-case.interface';

export class UpdateCustomerStatusUseCase implements IUpdateCustomerStatusUseCase {
  constructor(
    private readonly customerRepository: ICustomerRepository,
    private readonly workOrderRepository: IWorkOrderRepository,
    private readonly cache: ICache,
    private readonly logger: ILogger,
  ) {}

  async execute(customerId: string, isActive: boolean, actingUserId: string): Promise<void> {
    const customer = await this.customerRepository.findById(customerId);

    if (!customer) {
      throw new ResourceNotFoundException('Cliente', customerId);
    }

    if (isActive) {
      customer.activate();
    } else {
      customer.deactivate();
    }

    // Read before the write: a failed lookup must fail the request before anything is stored.
    const cacheKeys = await this.findWorkOrderCacheKeys(customerId);

    const updated = await this.customerRepository.update(customer);

    await this.cache.delete(cacheKeys);

    this.logger.event(BUSINESS_EVENTS.CUSTOMER_STATUS_UPDATED, {
      subjectId: actingUserId,
      customerId: updated.id,
      customerActive: updated.isActive,
    });
  }

  private async findWorkOrderCacheKeys(customerId: string): Promise<string[]> {
    const workOrders = await this.workOrderRepository.findByCustomerId(customerId);

    return workOrders.map((workOrder) => workOrderCacheKey(workOrder.id));
  }
}
