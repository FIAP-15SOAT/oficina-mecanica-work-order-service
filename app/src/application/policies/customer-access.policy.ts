import { IUserCustomerRepository } from '@domain/interfaces/repositories/user-customer.repository.interface';
import { ILogger } from '@application/ports/output/services/logger.service.interface';
import { BUSINESS_EVENTS } from '@application/logging/business-event.catalog';
import { ResourceNotFoundException } from '@application/exceptions/resource-not-found.exception';

/**
 * The link check does not live only in the HTTP guard: this policy can be
 * reused by any adapter that triggers the external use cases.
 * Never throws 403 — a missing resource and an unauthorized resource both
 * answer 404, so the route does not become an enumeration oracle.
 */
export class CustomerAccessPolicy {
  constructor(
    private readonly userCustomerRepository: IUserCustomerRepository,
    private readonly logger: ILogger,
  ) {}

  async getAuthorizedCustomerIds(userId: string): Promise<string[]> {
    return this.userCustomerRepository.findActiveCustomerIdsByUserId(userId);
  }

  async assertCustomerAuthorized(userId: string, customerId: string): Promise<void> {
    const authorized = await this.userCustomerRepository.existsActiveLink(userId, customerId);

    if (!authorized) {
      this.logger.event(BUSINESS_EVENTS.CUSTOMER_ACCESS_DENIED, {
        subjectId: userId,
        customerId,
        externalAccessFailureReason: 'no_active_link',
      });

      throw new ResourceNotFoundException('Recurso');
    }
  }
}
