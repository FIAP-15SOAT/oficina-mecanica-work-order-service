import { IUserCustomerRepository } from '@domain/interfaces/repositories/user-customer.repository.interface';
import { ActiveUserCustomerOutputDto } from '@application/ports/input/customer-access/dto/list-active-user-customers.dto';
import { IListActiveUserCustomersUseCase } from '@application/ports/input/customer-access/list-active-user-customers.use-case.interface';

export class ListActiveUserCustomersUseCase implements IListActiveUserCustomersUseCase {
  constructor(private readonly userCustomerRepository: IUserCustomerRepository) {}

  async execute(userId: string): Promise<ActiveUserCustomerOutputDto[]> {
    const customers = await this.userCustomerRepository.findActiveCustomersByUserId(userId);

    return customers.map((customer) => ({
      id: customer.id,
      name: customer.name,
      type: customer.type,
      document: customer.document.value,
      isActive: customer.isActive,
    }));
  }
}
