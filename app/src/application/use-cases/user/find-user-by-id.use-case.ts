import { IUserRepository } from '@domain/interfaces/repositories/user.repository.interface';
import { IUserCustomerRepository } from '@domain/interfaces/repositories/user-customer.repository.interface';
import { ResourceNotFoundException } from '@application/exceptions/resource-not-found.exception';
import { IFindUserByIdUseCase } from '@application/ports/input/user/find-user-by-id.use-case.interface';
import { FindUserByIdOutput } from '@application/ports/input/user/dto/find-user-by-id.dto';

export class FindUserByIdUseCase implements IFindUserByIdUseCase {
  constructor(
    private readonly userRepository: IUserRepository,
    private readonly userCustomerRepository: IUserCustomerRepository,
  ) {}

  async execute(id: string): Promise<FindUserByIdOutput> {
    const user = await this.userRepository.findById(id);

    if (!user) {
      throw new ResourceNotFoundException('Usuário', id);
    }

    const customers = await this.userCustomerRepository.findCustomersByUserId(id);

    return { ...user.toPublicView(), customers };
  }
}
