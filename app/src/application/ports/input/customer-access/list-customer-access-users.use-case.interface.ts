import { AccessUserOutputDto } from './dto/grant-customer-access.dto';

export interface IListCustomerAccessUsersUseCase {
  execute(customerId: string): Promise<AccessUserOutputDto[]>;
}
