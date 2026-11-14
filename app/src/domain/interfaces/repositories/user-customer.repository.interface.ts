import { UserCustomer } from '@domain/entities/user-customer.entity';
import { Customer } from '@domain/entities/customer.entity';

export interface IUserCustomerRepository {
  create(link: UserCustomer): Promise<UserCustomer>;
  exists(userId: string, customerId: string): Promise<boolean>;
  existsActiveLink(userId: string, customerId: string): Promise<boolean>;
  delete(userId: string, customerId: string): Promise<void>;
  findUserIdsByCustomerId(customerId: string): Promise<string[]>;
  findCustomersByUserId(userId: string): Promise<Customer[]>;
  findActiveCustomersByUserId(userId: string): Promise<Customer[]>;
  findActiveCustomerIdsByUserId(userId: string): Promise<string[]>;
}
