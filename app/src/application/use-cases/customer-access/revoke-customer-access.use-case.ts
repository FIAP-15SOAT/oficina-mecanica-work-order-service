import { IUserCustomerRepository } from '@domain/interfaces/repositories/user-customer.repository.interface';
import { ILogger } from '@application/ports/output/services/logger.service.interface';
import { BUSINESS_EVENTS } from '@application/logging/business-event.catalog';
import { ResourceNotFoundException } from '@application/exceptions/resource-not-found.exception';
import { IRevokeCustomerAccessUseCase } from '@application/ports/input/customer-access/revoke-customer-access.use-case.interface';

export class RevokeCustomerAccessUseCase implements IRevokeCustomerAccessUseCase {
  constructor(
    private readonly userCustomerRepository: IUserCustomerRepository,
    private readonly logger: ILogger,
  ) {}

  async execute(customerId: string, userId: string, actingUserId: string): Promise<void> {
    const exists = await this.userCustomerRepository.exists(userId, customerId);

    if (!exists) {
      throw new ResourceNotFoundException('Vínculo de acesso');
    }

    await this.userCustomerRepository.delete(userId, customerId);

    this.logger.event(BUSINESS_EVENTS.CUSTOMER_ACCESS_REVOKED, {
      subjectId: actingUserId,
      targetUserId: userId,
      customerId,
    });
  }
}
