import { ICustomerRepository } from '@domain/interfaces/repositories/customer.repository.interface';
import { IUserCustomerRepository } from '@domain/interfaces/repositories/user-customer.repository.interface';
import { ResourceNotFoundException } from '@application/exceptions/resource-not-found.exception';
import { IIdentityUsersGateway } from '@application/ports/output/gateways/identity/identity-users-gateway.interface';
import { AccessUserOutputDto } from '@application/ports/input/customer-access/dto/grant-customer-access.dto';
import { IListCustomerAccessUsersUseCase } from '@application/ports/input/customer-access/list-customer-access-users.use-case.interface';

export class ListCustomerAccessUsersUseCase implements IListCustomerAccessUsersUseCase {
  constructor(
    private readonly customerRepository: ICustomerRepository,
    private readonly userCustomerRepository: IUserCustomerRepository,
    private readonly identityUsersGateway: IIdentityUsersGateway,
  ) {}

  async execute(customerId: string): Promise<AccessUserOutputDto[]> {
    const customer = await this.customerRepository.findById(customerId);

    if (!customer) {
      throw new ResourceNotFoundException('Cliente', customerId);
    }

    const userIds = await this.userCustomerRepository.findUserIdsByCustomerId(customerId);

    return this.identityUsersGateway.findByIds(userIds);
  }
}
