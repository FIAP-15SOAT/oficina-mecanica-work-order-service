import { AccessUserOutputDto } from '@application/ports/input/customer-access/dto/grant-customer-access.dto';
import { LinkedCustomerOutputDto } from '@application/ports/input/customer-access/dto/list-user-customers.dto';

export interface CustomerAccessResponse {
  user: AccessUserOutputDto;
  customer: LinkedCustomerOutputDto;
  initialPasswordSent: boolean;
}

export interface CustomerAccessDataResponse {
  data: CustomerAccessResponse;
}

export interface AccessUserListResponse {
  data: AccessUserOutputDto[];
}

export interface LinkedCustomerListResponse {
  data: LinkedCustomerOutputDto[];
}
