import { ActiveUserCustomerOutputDto } from './dto/list-active-user-customers.dto';

export interface IListActiveUserCustomersUseCase {
  execute(userId: string): Promise<ActiveUserCustomerOutputDto[]>;
}
