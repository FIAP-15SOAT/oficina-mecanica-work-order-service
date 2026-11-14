import { ActiveUserCustomerOutputDto } from '@application/ports/input/customer-access/dto/list-active-user-customers.dto';

export interface InternalUserCustomerListResponse {
  data: ActiveUserCustomerOutputDto[];
}
