import { IUserCustomerRepository } from '@domain/interfaces/repositories/user-customer.repository.interface';
import { ResourceNotFoundException } from '@application/exceptions/resource-not-found.exception';
import { IIdentityUsersGateway } from '@application/ports/output/gateways/identity/identity-users-gateway.interface';
import { LinkedCustomerOutputDto } from '@application/ports/input/customer-access/dto/list-user-customers.dto';
import { IListUserCustomersUseCase } from '@application/ports/input/customer-access/list-user-customers.use-case.interface';

export class ListUserCustomersUseCase implements IListUserCustomersUseCase {
  constructor(
    private readonly identityUsersGateway: IIdentityUsersGateway,
    private readonly userCustomerRepository: IUserCustomerRepository,
  ) {}

  async execute(userId: string): Promise<LinkedCustomerOutputDto[]> {
    const user = await this.identityUsersGateway.findById(userId);

    if (!user) {
      throw new ResourceNotFoundException('Usuário', userId);
    }

    const customers = await this.userCustomerRepository.findCustomersByUserId(userId);

    return customers.map((customer) => ({
      id: customer.id,
      name: customer.name,
      type: customer.type,
      isActive: customer.isActive,
    }));
  }
}
